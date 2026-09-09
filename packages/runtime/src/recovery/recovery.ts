import type { Locator } from '@orbit/agent-ir';
import type { AgentVersionId, RunStepId } from '@orbit/contracts';
import type { ElementFingerprint, FingerprintMismatch } from '@orbit/execution-mapping';

import type { StepBinding } from './drift';
import type { RuntimeLogger } from '../logger';
import type {
  BrowserExecutor,
  DriftCandidateObservation,
  DriftObservation,
  RecoveryProposalOutcome,
  RecoveryProposer,
  RunRecorder,
} from '../ports';

/**
 * The runtime's half of bounded recovery (ADR-033).
 *
 * It runs *after* the decision to fail has already been made, and it cannot
 * unmake it. `verifyBinding` throws whether this produced a proposal, declined
 * to, or threw itself. That ordering is the whole safety property: the run that
 * met the drift still stops with its evidence, and recovery is only ever about
 * making the *next* run work, once a person has approved it.
 *
 * What happens here is observation, not judgement. The live page and the
 * approved fingerprint exist together in exactly one place, so this gathers
 * what both say and hands it to a port. Which candidate is the replacement,
 * how confident that is, and whether it is worth showing anyone are decided on
 * the other side of that port, where there is no browser to be tempted by.
 */

/**
 * How long one fallback locator is given to answer.
 *
 * Deliberately short, and deliberately not the step's budget. The run has
 * already failed by the time this runs; a diagnosis that took fifteen seconds
 * per candidate would convert a fast, clear failure into a stall, and could
 * push a run that should have stopped promptly into its own deadline. A chain
 * holds at most four locators, so the whole probe is bounded by a few seconds.
 */
const RECOVERY_PROBE_TIMEOUT_MS = 1_000;

/** Everything recovery needs that `verifyBinding` does not otherwise hold. */
export interface RecoveryContext {
  /** Absent when the deployment wired no proposer. Nothing is attempted then. */
  readonly proposer: RecoveryProposer | undefined;
  /** `permissions.recovery.allowed`. False means not even an observation. */
  readonly permitted: boolean;
  readonly recorder: RunRecorder;
  readonly runStepId: RunStepId;
  readonly agentVersionId: AgentVersionId;
  readonly agentId: string;
}

export interface AttemptRecoveryInput {
  readonly recovery?: RecoveryContext;
  readonly executor: BrowserExecutor;
  readonly binding: StepBinding;
  readonly agentStepId: string;
  readonly failedLocator: Locator;
  readonly failure: DriftObservation['failure'];
  readonly observed: ElementFingerprint | null;
  readonly mismatches: readonly FingerprintMismatch[];
  readonly logger: RuntimeLogger;
}

function sameLocator(left: Locator, right: Locator): boolean {
  return left.strategy === right.strategy && left.value === right.value && left.name === right.name;
}

/**
 * Asks each *remaining* locator in the binding's own chain what it finds now.
 *
 * The chain is the boundary of the search, and that is the point. A person
 * demonstrated this step once, and the recorder verified every entry in the
 * chain resolved uniquely to the element they meant — so a fallback that still
 * resolves is a locator with a human's signature on it, not an element Orbit
 * went looking for. Scanning the page for lookalikes would produce candidates
 * nobody had ever approved, which is the search this deliberately does not do.
 */
async function probeChain(
  input: AttemptRecoveryInput,
): Promise<readonly DriftCandidateObservation[]> {
  const chain = input.binding.selectors ?? [];
  const observations: DriftCandidateObservation[] = [];

  for (const locator of chain) {
    if (sameLocator(locator, input.failedLocator)) {
      continue;
    }

    try {
      const described = await input.executor.describeElement({
        locator,
        timeoutMs: RECOVERY_PROBE_TIMEOUT_MS,
      });

      observations.push({ locator, resolved: true, fingerprint: described });
    } catch {
      // A locator that finds nothing, finds more than one thing, or times out
      // all mean the same thing here: it is not usable as a replacement. The
      // distinction is not swallowed — it is recorded as `resolved: false`, and
      // an unresolved candidate can never become a proposal.
      observations.push({ locator, resolved: false, fingerprint: null });
    }
  }

  return observations;
}

/**
 * Observes the drift, asks for a proposal, and records what came back.
 *
 * Never throws. A proposer that fails is a diagnosis nobody gets, which is a
 * strictly smaller problem than a failed run losing the error that explains it
 * — so the failure is logged and recorded as a declined recovery rather than
 * replacing the drift error the caller is about to raise.
 */
export async function attemptRecovery(input: AttemptRecoveryInput): Promise<void> {
  const recovery = input.recovery;

  if (recovery === undefined || recovery.proposer === undefined || !recovery.permitted) {
    return;
  }

  const observation: DriftObservation = {
    context: {
      runId: recovery.recorder.runId,
      agentVersionId: recovery.agentVersionId,
      agentId: recovery.agentId,
      agentStepId: input.agentStepId,
    },
    bindingId: input.binding.bindingId,
    mode: input.binding.mode,
    expected: input.binding.fingerprint,
    failedLocator: input.failedLocator,
    failure: input.failure,
    observed: input.observed,
    mismatches: input.mismatches,
    candidates: await probeChain(input),
  };

  let outcome: RecoveryProposalOutcome;

  try {
    outcome = await recovery.proposer.propose(observation);
  } catch (error) {
    input.logger.warn(
      {
        agentStepId: input.agentStepId,
        bindingId: input.binding.bindingId,
        cause: error instanceof Error ? error.message : String(error),
      },
      'Recovery could not be attempted; the run still fails on the drift.',
    );

    outcome = {
      proposed: false,
      reason: 'store_failed',
      summary: 'Orbit could not record a recovery proposal for this step.',
    };
  }

  await record(recovery, input, observation, outcome);
}

/** The audit trail. A declined recovery is recorded as carefully as a proposed one. */
async function record(
  recovery: RecoveryContext,
  input: AttemptRecoveryInput,
  observation: DriftObservation,
  outcome: RecoveryProposalOutcome,
): Promise<void> {
  const shared = {
    bindingId: observation.bindingId,
    failure: observation.failure,
    failedLocator: describe(observation.failedLocator),
    // Which locators were tried and whether each still finds anything. Never
    // page content: a fingerprint's text is the element's own label, and that
    // is all a reader needs to see why one candidate was preferred.
    candidates: observation.candidates.map((candidate) => ({
      locator: describe(candidate.locator),
      resolved: candidate.resolved,
    })),
  };

  try {
    await recovery.recorder.appendEvent({
      eventType: outcome.proposed ? 'recovery.proposed' : 'recovery.declined',
      payload: outcome.proposed
        ? { ...shared, proposalId: outcome.proposalId, summary: outcome.summary }
        : { ...shared, reason: outcome.reason, summary: outcome.summary },
      runStepId: recovery.runStepId,
      agentStepId: input.agentStepId,
    });
  } catch (error) {
    // The drift error is the one that must survive. Losing an evidence event is
    // worth reporting; it is not worth replacing the reason the run stopped.
    input.logger.warn(
      {
        agentStepId: input.agentStepId,
        cause: error instanceof Error ? error.message : String(error),
      },
      'Could not append the recovery event; the run still fails on the drift.',
    );
  }
}

function describe(locator: Locator): string {
  return locator.strategy === 'role_and_name'
    ? `${locator.strategy}=${locator.value}${locator.name === undefined ? '' : ` "${locator.name}"`}`
    : `${locator.strategy}=${locator.value}`;
}
