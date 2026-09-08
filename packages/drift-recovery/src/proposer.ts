import type { ExecutionBinding, SelectorChain } from '@orbit/execution-mapping';
import { bindingTargets } from '@orbit/execution-mapping';
import type { DriftObservation, RecoveryProposalOutcome, RecoveryProposer } from '@orbit/runtime';

import { diagnoseDrift, type DriftDiagnosis } from './diagnose';

/**
 * The implementation behind @orbit/runtime's `RecoveryProposer` port.
 *
 * Three things happen here and nothing else: the observation is diagnosed, a
 * replacement binding document is assembled from the *existing* binding, and it
 * is handed to a store. There is deliberately no code path that approves it,
 * supersedes anything, touches an Agent Version, or reaches a browser — and the
 * absence is structural rather than a rule, because this package depends on
 * none of those things (ADR-033).
 */

/** Where a proposal is read from and written to. Satisfied by the composition root. */
export interface RecoveryProposalStore {
  /**
   * The document, step and approved binding behind the binding id a run reports.
   *
   * Null when the binding cannot be resolved — a version published from a
   * fixture, a document since deleted — which is reported as `unknown_binding`
   * rather than guessed at.
   */
  contextFor(observation: DriftObservation): Promise<RecoveryTarget | null>;
  /** Stores the proposal, or reports that this step already has an open one. */
  save(input: SaveRecoveryProposalInput): Promise<SaveRecoveryProposalResult>;
}

export interface RecoveryTarget {
  readonly documentId: string;
  readonly stepId: string;
  /** The approved binding as stored. Never modified by anything here. */
  readonly binding: ExecutionBinding;
}

export interface SaveRecoveryProposalInput {
  readonly observation: DriftObservation;
  readonly target: RecoveryTarget;
  readonly proposedBinding: ExecutionBinding;
  readonly diagnosis: Record<string, unknown>;
}

export type SaveRecoveryProposalResult =
  | { readonly saved: true; readonly proposalId: string }
  | { readonly saved: false; readonly reason: 'already_proposed' };

/**
 * Rewrites one binding's selector chain, and touches nothing else.
 *
 * Everything a proposal does not change is as important as the one thing it
 * does: the step it binds to, what it fills a value from, what it extracts into,
 * the revision it was captured against and the step checksum all carry over
 * untouched. A proposal that could alter any of those would be a workflow edit
 * arriving through a recovery path, which is not what anyone accepting a
 * proposal believes they are approving.
 *
 * The fingerprint carries over too. Orbit is claiming this is the *same*
 * element under a different name — so the thing a person approved stays the
 * thing the next run checks against, and if that claim is wrong, the next run
 * drifts again and stops again.
 */
function rebind(binding: ExecutionBinding, selectors: SelectorChain): ExecutionBinding | null {
  if (binding.body.kind === 'decision') {
    // A decision has one element per branch and is resolved by racing them, so
    // no single `target` exists to replace and the runtime never drift-checks
    // one. Refused rather than half-handled.
    return null;
  }

  return {
    ...binding,
    body: { ...binding.body, target: { ...binding.body.target, selectors } },
  };
}

export function createDriftRecoveryProposer(options: {
  readonly store: RecoveryProposalStore;
}): RecoveryProposer {
  return {
    async propose(observation: DriftObservation): Promise<RecoveryProposalOutcome> {
      const target = await options.store.contextFor(observation);

      if (target === null) {
        return {
          proposed: false,
          reason: 'unknown_binding',
          summary:
            'This run could not be traced back to the workflow document its binding came from, so there is nothing to attach a proposal to.',
        };
      }

      const diagnosis = diagnoseDrift(observation);

      if (!diagnosis.recoverable) {
        return { proposed: false, reason: diagnosis.reason, summary: diagnosis.summary };
      }

      const proposedBinding = rebind(target.binding, diagnosis.proposedSelectors);

      if (proposedBinding === null || bindingTargets(proposedBinding.body).length !== 1) {
        return {
          proposed: false,
          reason: 'not_recoverable',
          summary:
            'This kind of step names more than one element, so a single replacement would not describe it.',
        };
      }

      const result = await options.store.save({
        observation,
        target,
        proposedBinding,
        diagnosis: toStoredDiagnosis(diagnosis),
      });

      return result.saved
        ? { proposed: true, proposalId: result.proposalId, summary: diagnosis.summary }
        : {
            proposed: false,
            reason: 'already_proposed',
            summary:
              'Orbit had already proposed a repair for this step, and did not write a second copy of it.',
          };
    },
  };
}

/** The diagnosis as it is stored: readable by a person, read by no code path. */
function toStoredDiagnosis(
  diagnosis: DriftDiagnosis & { recoverable: true },
): Record<string, unknown> {
  return {
    confidence: diagnosis.confidence,
    // The word "deterministic" is stored beside the confidence on purpose: a
    // reader six months from now should not have to know when ranking was
    // switched on to know which kind of proposal they are looking at.
    method: 'deterministic_selector_chain',
    summary: diagnosis.summary,
    replacement: diagnosis.evidence.checked,
    failedLocator: diagnosis.evidence.failedLocator,
    failure: diagnosis.evidence.failure,
    approvedFingerprint: diagnosis.evidence.approved,
    observedFingerprint: diagnosis.evidence.observed,
  };
}
