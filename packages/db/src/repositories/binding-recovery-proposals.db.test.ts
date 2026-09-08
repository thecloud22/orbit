import type { SopDocumentId, SopRevisionId } from '@orbit/contracts';
import { buttonFingerprint, clickBinding } from '@orbit/execution-mapping/testing';
import { escalationReviewGraph } from '@orbit/sop-graph/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { createRepositories } from './index';
import { RecoveryProposalAlreadyOpenError } from './binding-recovery-proposals';
import { useTestDatabase } from '../testing/harness';

/**
 * Recovery proposals against real persistence (ADR-033).
 *
 * The property this file exists for is the one that would be easy to lose in a
 * refactor and impossible to notice afterwards: **an open proposal changes
 * nothing.** The binding it is about stays approved, stays current, and stays
 * the one a compile would use. A proposal that quietly shadowed its own subject
 * would block publishing a document with nothing wrong with it.
 */
describe('recovery proposal persistence', () => {
  const getDatabase = useTestDatabase();

  let documentId: SopDocumentId;
  let revisionId: SopRevisionId;

  beforeEach(async () => {
    const repositories = createRepositories(getDatabase().db);
    const document = await repositories.sopDocuments.create({
      title: 'Escalation review',
      sourceText: 'Sign in and review the escalation.',
    });
    const revision = await repositories.sopGraphRevisions.create({
      documentId: document.id,
      graph: escalationReviewGraph(),
      provenance: { kind: 'authored' },
    });
    documentId = document.id;
    revisionId = revision.id;
  });

  function repositories() {
    return createRepositories(getDatabase().db);
  }

  async function approvedBinding() {
    const created = await repositories().executionBindings.create({
      documentId,
      binding: clickBinding({ capturedAgainstRevisionId: revisionId }),
    });
    await repositories().executionBindings.submitForReview(created.id);
    return repositories().executionBindings.approve(created.id, { reviewNote: 'Demonstrated.' });
  }

  async function proposeAgainst(bindingId: string) {
    return repositories().bindingRecoveryProposals.create({
      documentId,
      stepId: 'search_request',
      proposedForBindingId: bindingId as never,
      proposedBinding: clickBinding({
        capturedAgainstRevisionId: revisionId,
        body: {
          kind: 'click',
          target: {
            selectors: [{ strategy: 'role_and_name', value: 'button', name: 'Search' }],
            fingerprint: buttonFingerprint(),
          },
        },
      }),
      diagnosis: { confidence: 'high', summary: 'The test id changed; the button did not.' },
    });
  }

  it('leaves the binding it is about completely untouched', async () => {
    const binding = await approvedBinding();
    await proposeAgainst(binding.id);

    const current = await repositories().executionBindings.findCurrent(
      documentId,
      'search_request',
    );

    // Still approved, still current, still the binding a compile would use. A
    // proposal supersedes nothing until a person accepts it.
    expect(current?.id).toBe(binding.id);
    expect(current?.state).toBe('approved');
    expect(current?.supersededByBindingId).toBeNull();

    const live = await repositories().executionBindings.listCurrent(documentId);
    expect(live.map((one) => one.id)).toEqual([binding.id]);
  });

  it('refuses a second open proposal for the same step', async () => {
    const binding = await approvedBinding();
    await proposeAgainst(binding.id);

    // A drifted agent running on a schedule would otherwise write one identical
    // proposal per run.
    await expect(proposeAgainst(binding.id)).rejects.toBeInstanceOf(
      RecoveryProposalAlreadyOpenError,
    );
  });

  it('allows a new proposal once the previous one is resolved', async () => {
    const binding = await approvedBinding();
    const first = await proposeAgainst(binding.id);
    await repositories().bindingRecoveryProposals.dismiss(first.id, { resolutionNote: 'Not it.' });

    const second = await proposeAgainst(binding.id);
    expect(second.id).not.toBe(first.id);

    const open = await repositories().bindingRecoveryProposals.listOpen(documentId);
    expect(open.map((one) => one.id)).toEqual([second.id]);
  });

  it('refuses to resolve the same proposal twice', async () => {
    const binding = await approvedBinding();
    const proposal = await proposeAgainst(binding.id);

    await repositories().bindingRecoveryProposals.dismiss(proposal.id);
    await expect(
      repositories().bindingRecoveryProposals.accept(proposal.id, binding.id),
    ).rejects.toThrow(/already "dismissed"/);
  });

  it('refuses to store an invalid proposed binding', async () => {
    const binding = await approvedBinding();

    await expect(
      repositories().bindingRecoveryProposals.create({
        documentId,
        stepId: 'search_request',
        proposedForBindingId: binding.id,
        proposedBinding: { nonsense: true } as never,
        diagnosis: {},
      }),
    ).rejects.toThrow(/invalid recovery proposal/);
  });

  it('defaults a document to no recovery grant, and records one when given', async () => {
    const document = await repositories().sopDocuments.findById(documentId);
    expect(document?.recoveryEnabled).toBe(false);

    const granted = await repositories().sopDocuments.setRecoveryEnabled(documentId, true);
    expect(granted.recoveryEnabled).toBe(true);
    expect((await repositories().sopDocuments.findById(documentId))?.recoveryEnabled).toBe(true);
  });
});
