import type { BindingRecoveryProposalId, SopDocumentId } from '@orbit/contracts';
import {
  createRepositories,
  stepChecksum,
  withTransaction,
  type BindingRecoveryProposalRecord,
  type ExecutionBindingRecord,
  type OrbitDatabase,
} from '@orbit/db';
import { validateBindingAgainstStep } from '@orbit/execution-mapping';
import type { SopStep } from '@orbit/sop-graph';

import { declaredNames } from './binding-service';

/**
 * Recovery proposals, on the document side of the port (ADR-033).
 *
 * Two responsibilities, and the split between them is the whole design:
 *
 *   - **Writing** a proposal, which a failing run does. It creates a row and
 *     nothing else. No binding changes, no version is published, and the run
 *     that wrote it has already failed.
 *   - **Accepting** one, which only a person does. That creates a real binding
 *     through the ordinary lifecycle — `create` -> `submitForReview` ->
 *     `approve`, the same three calls a recorded step goes through — so there
 *     is exactly one way a binding is ever made, and recovery is not a second
 *     one.
 *
 * Between the two there is no automation. Nothing polls for proposals, nothing
 * accepts one on a timer, and nothing re-runs the workflow when one appears.
 */

export type AcceptRecoveryProposalResult =
  | { readonly ok: true; readonly binding: ExecutionBindingRecord }
  | {
      readonly ok: false;
      readonly reason: 'not_found' | 'already_resolved' | 'superseded' | 'stale' | 'invalid';
      readonly message: string;
    };

/**
 * Accepts a proposal: creates the binding, approves it, and closes the proposal.
 *
 * Three refusals stand between a click and a live mapping, and each guards a
 * way the world can have moved on since the proposal was written:
 *
 *   - The step's live binding is no longer the one the proposal is about —
 *     someone re-recorded it in the meantime. Accepting would silently
 *     supersede work newer than the proposal.
 *   - The step itself has been edited, so `stepSha256` no longer matches. The
 *     proposal describes an element for a step that has since changed meaning.
 *   - The proposed binding does not validate against the step as it now reads.
 *
 * All three are refusals rather than repairs. A proposal is a sentence written
 * at a particular moment, and a stale one is withdrawn, never adjusted.
 */
export async function acceptRecoveryProposal(input: {
  readonly database: OrbitDatabase;
  readonly proposalId: BindingRecoveryProposalId;
  readonly reviewNote?: string;
}): Promise<AcceptRecoveryProposalResult> {
  const repositories = createRepositories(input.database);
  const proposal = await repositories.bindingRecoveryProposals.findById(input.proposalId);

  if (proposal === null) {
    return { ok: false, reason: 'not_found', message: 'That recovery proposal does not exist.' };
  }

  if (proposal.state !== 'proposed') {
    return {
      ok: false,
      reason: 'already_resolved',
      message: `This proposal has already been ${proposal.state}.`,
    };
  }

  const current = await repositories.executionBindings.findCurrent(
    proposal.documentId,
    proposal.stepId,
  );

  if (current === null || current.id !== proposal.proposedForBindingId) {
    return {
      ok: false,
      reason: 'superseded',
      message:
        'This step has been re-recorded since Orbit proposed a repair for it, so the proposal is about a mapping that is no longer live. Dismiss it and check the current binding.',
    };
  }

  const revision = await repositories.sopGraphRevisions.findCurrent(proposal.documentId);
  const step = revision?.graph.steps.find((candidate: SopStep) => candidate.id === proposal.stepId);

  if (revision === null || step === undefined) {
    return {
      ok: false,
      reason: 'stale',
      message: 'The step this proposal is about is no longer in the workflow.',
    };
  }

  // The same validator the recorder, the read view and the publish gate use, so
  // "usable" means one thing everywhere. A proposal is not exempt from it
  // because Orbit wrote it — if anything the reverse.
  const issues = validateBindingAgainstStep(proposal.proposedBinding, {
    stepId: step.id,
    kind: step.kind,
    declaredNames: declaredNames(revision.graph),
    stepSha256: stepChecksum(step),
    ...(step.kind === 'decision' ? { branchConditions: step.branches.map((b) => b.when) } : {}),
  });

  if (issues.length > 0) {
    return {
      ok: false,
      reason: 'invalid',
      message: `This proposal no longer fits the step it is about: ${issues.map((issue) => issue.message).join('; ')}`,
    };
  }

  const binding = await withTransaction(input.database, async (transactional) => {
    const created = await transactional.executionBindings.create({
      documentId: proposal.documentId,
      binding: proposal.proposedBinding,
      // Supersedes the drifted binding here, at accept time, and not one moment
      // earlier. That is the difference between a proposal and a change.
      parentBindingId: proposal.proposedForBindingId,
    });

    // Through the lifecycle, never around it: the repository refuses
    // draft -> approved, and writing a state the application cannot otherwise
    // produce would make the state machine advisory.
    await transactional.executionBindings.submitForReview(created.id);
    const approved = await transactional.executionBindings.approve(created.id, {
      reviewNote:
        input.reviewNote ??
        `Accepted Orbit's recovery proposal ${proposal.id} for step "${proposal.stepId}".`,
    });

    await transactional.bindingRecoveryProposals.accept(proposal.id, approved.id, {
      ...(input.reviewNote === undefined ? {} : { resolutionNote: input.reviewNote }),
    });

    return approved;
  });

  return { ok: true, binding };
}

export type DismissRecoveryProposalResult =
  | { readonly ok: true; readonly proposal: BindingRecoveryProposalRecord }
  | {
      readonly ok: false;
      readonly reason: 'not_found' | 'already_resolved';
      readonly message: string;
    };

export async function dismissRecoveryProposal(input: {
  readonly database: OrbitDatabase;
  readonly proposalId: BindingRecoveryProposalId;
  readonly note?: string;
}): Promise<DismissRecoveryProposalResult> {
  const repositories = createRepositories(input.database);
  const proposal = await repositories.bindingRecoveryProposals.findById(input.proposalId);

  if (proposal === null) {
    return { ok: false, reason: 'not_found', message: 'That recovery proposal does not exist.' };
  }

  if (proposal.state !== 'proposed') {
    return {
      ok: false,
      reason: 'already_resolved',
      message: `This proposal has already been ${proposal.state}.`,
    };
  }

  return {
    ok: true,
    proposal: await repositories.bindingRecoveryProposals.dismiss(proposal.id, {
      ...(input.note === undefined ? {} : { resolutionNote: input.note }),
    }),
  };
}

/** Open proposals for a document, newest first. */
export async function listOpenRecoveryProposals(
  database: OrbitDatabase,
  documentId: SopDocumentId,
): Promise<readonly BindingRecoveryProposalRecord[]> {
  return createRepositories(database).bindingRecoveryProposals.listOpen(documentId);
}

/** Whether Orbit may propose repairs for agents published from this document. */
export async function setDocumentRecoveryEnabled(
  database: OrbitDatabase,
  documentId: SopDocumentId,
  enabled: boolean,
): Promise<boolean> {
  const document = await createRepositories(database).sopDocuments.setRecoveryEnabled(
    documentId,
    enabled,
  );

  return document.recoveryEnabled;
}

/**
 * Recovery proposals, as the API is given them.
 *
 * An interface for the same reason every other service here is one: the whole
 * HTTP surface is testable against a fake, with no database.
 */
export interface RecoveryProposalService {
  listOpen(documentId: SopDocumentId): Promise<readonly BindingRecoveryProposalRecord[]>;
  accept(
    proposalId: BindingRecoveryProposalId,
    reviewNote?: string,
  ): Promise<AcceptRecoveryProposalResult>;
  dismiss(
    proposalId: BindingRecoveryProposalId,
    note?: string,
  ): Promise<DismissRecoveryProposalResult>;
  /** The document's grant. Returns the value now in force. */
  setEnabled(documentId: SopDocumentId, enabled: boolean): Promise<boolean>;
  isEnabled(documentId: SopDocumentId): Promise<boolean | null>;
}

export function createRecoveryProposalService(options: {
  readonly database: OrbitDatabase;
}): RecoveryProposalService {
  return {
    async listOpen(documentId) {
      return listOpenRecoveryProposals(options.database, documentId);
    },

    async accept(proposalId, reviewNote) {
      return acceptRecoveryProposal({
        database: options.database,
        proposalId,
        ...(reviewNote === undefined ? {} : { reviewNote }),
      });
    },

    async dismiss(proposalId, note) {
      return dismissRecoveryProposal({
        database: options.database,
        proposalId,
        ...(note === undefined ? {} : { note }),
      });
    },

    async setEnabled(documentId, enabled) {
      return setDocumentRecoveryEnabled(options.database, documentId, enabled);
    },

    async isEnabled(documentId) {
      const document = await createRepositories(options.database).sopDocuments.findById(documentId);
      return document === null ? null : document.recoveryEnabled;
    },
  };
}
