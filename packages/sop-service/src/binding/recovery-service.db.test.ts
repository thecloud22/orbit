import {
  newBindingRecoveryProposalId,
  type SopDocumentId,
  type SopRevisionId,
} from '@orbit/contracts';
import { createRepositories, stepChecksum } from '@orbit/db';
import { useTestDatabase } from '@orbit/db/testing';
import { buttonFingerprint, clickBinding } from '@orbit/execution-mapping/testing';
import { escalationReviewGraph } from '@orbit/sop-graph/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { acceptRecoveryProposal, dismissRecoveryProposal } from './recovery-service';

/**
 * Accepting a proposal, against real persistence (ADR-033).
 *
 * Accepting is the only act in Orbit that turns a proposal into a mapping, and
 * these are the two things it must be true of: it goes through the *ordinary*
 * binding lifecycle rather than around it, and it refuses whenever the world
 * has moved since the proposal was written.
 */
describe('accepting a recovery proposal', () => {
  const getDatabase = useTestDatabase();

  let documentId: SopDocumentId;
  let revisionId: SopRevisionId;
  let stepId: string;

  function repositories() {
    return createRepositories(getDatabase().db);
  }

  beforeEach(async () => {
    const graph = escalationReviewGraph();
    const step = graph.steps.find((one) => one.kind === 'click');

    if (step === undefined) {
      throw new Error('fixture changed: escalationReviewGraph must contain a click step');
    }

    stepId = step.id;

    const document = await repositories().sopDocuments.create({
      title: 'Escalation review',
      sourceText: 'Sign in and review the escalation.',
    });
    const revision = await repositories().sopGraphRevisions.create({
      documentId: document.id,
      graph,
      provenance: { kind: 'authored' },
    });

    documentId = document.id;
    revisionId = revision.id;
  });

  function binding(
    selectors: { strategy: 'test_id' | 'role_and_name'; value: string; name?: string }[],
  ) {
    const graph = escalationReviewGraph();
    const step = graph.steps.find((one) => one.id === stepId)!;

    return clickBinding({
      stepId,
      capturedAgainstRevisionId: revisionId,
      stepSha256: stepChecksum(step),
      body: { kind: 'click', target: { selectors, fingerprint: buttonFingerprint() } },
    });
  }

  async function approvedBinding() {
    const created = await repositories().executionBindings.create({
      documentId,
      binding: binding([
        { strategy: 'test_id', value: 'escalate-button' },
        { strategy: 'role_and_name', value: 'button', name: 'Search' },
      ]),
    });
    await repositories().executionBindings.submitForReview(created.id);
    return repositories().executionBindings.approve(created.id, { reviewNote: 'Demonstrated.' });
  }

  async function proposal(forBindingId: string) {
    return repositories().bindingRecoveryProposals.create({
      documentId,
      stepId,
      proposedForBindingId: forBindingId as never,
      proposedBinding: binding([{ strategy: 'role_and_name', value: 'button', name: 'Search' }]),
      diagnosis: { confidence: 'high', summary: 'The test id changed; the button did not.' },
    });
  }

  it('creates an approved binding through the ordinary lifecycle and supersedes the old one', async () => {
    const original = await approvedBinding();
    const pending = await proposal(original.id);

    const result = await acceptRecoveryProposal({
      database: getDatabase().db,
      proposalId: pending.id,
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    // The new binding is approved, is the step's live mapping, and records that
    // it replaced the old one. The old one is superseded, not deleted: the chain
    // is the mapping history.
    expect(result.binding.state).toBe('approved');
    expect(result.binding.parentBindingId).toBe(original.id);

    const superseded = await repositories().executionBindings.findById(original.id);
    expect(superseded?.state).toBe('superseded');
    expect(superseded?.supersededByBindingId).toBe(result.binding.id);

    const current = await repositories().executionBindings.findCurrent(documentId, stepId);
    expect(current?.id).toBe(result.binding.id);

    const closed = await repositories().bindingRecoveryProposals.findById(pending.id);
    expect(closed?.state).toBe('accepted');
    expect(closed?.resultingBindingId).toBe(result.binding.id);
  });

  it('refuses when the step has been re-recorded since the proposal', async () => {
    const original = await approvedBinding();
    const pending = await proposal(original.id);

    // Somebody demonstrated the step again while the proposal was waiting.
    const replacement = await repositories().executionBindings.create({
      documentId,
      binding: binding([{ strategy: 'test_id', value: 'escalate-button-v3' }]),
      parentBindingId: original.id,
    });
    await repositories().executionBindings.submitForReview(replacement.id);
    await repositories().executionBindings.approve(replacement.id);

    const result = await acceptRecoveryProposal({
      database: getDatabase().db,
      proposalId: pending.id,
    });

    // A refusal, not a repair. Accepting would silently supersede work newer
    // than the proposal.
    expect(result).toMatchObject({ ok: false, reason: 'superseded' });
  });

  it('refuses a proposal that has already been resolved', async () => {
    const original = await approvedBinding();
    const pending = await proposal(original.id);

    await dismissRecoveryProposal({ database: getDatabase().db, proposalId: pending.id });

    const result = await acceptRecoveryProposal({
      database: getDatabase().db,
      proposalId: pending.id,
    });

    expect(result).toMatchObject({ ok: false, reason: 'already_resolved' });
  });

  it('refuses a proposal that does not exist', async () => {
    const result = await acceptRecoveryProposal({
      database: getDatabase().db,
      proposalId: newBindingRecoveryProposalId(),
    });

    expect(result).toMatchObject({ ok: false, reason: 'not_found' });
  });
});
