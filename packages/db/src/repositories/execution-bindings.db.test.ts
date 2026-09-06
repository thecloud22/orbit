import type { SopDocumentId, SopRevisionId } from '@orbit/contracts';
import { clickBinding, fillBinding } from '@orbit/execution-mapping/testing';
import { BINDING_STATES, type BindingState } from '@orbit/execution-mapping';
import { escalationReviewGraph } from '@orbit/sop-graph/testing';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { createRepositories } from './index';
import { executionBindings } from '../schema';
import { useTestDatabase } from '../testing/harness';
import { SOP_REVISION_TRANSITIONS } from './sop-graph-revisions';

/**
 * Execution bindings against real persistence.
 *
 * Bindings are hand-authored fixtures here, exactly as Phase 1's Agent IR was
 * hand-authored before anything generated one. Sub-phase 2.4b's recorder will
 * produce them for real; the contract, the chain and the state machine are
 * provable without it.
 */
describe('execution binding persistence', () => {
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

  /**
   * The recorded revision must be a real one: `captured_against_revision_id` is
   * a foreign key precisely so a binding can never point at a revision nobody
   * can look up.
   */
  function click() {
    return clickBinding({ capturedAgainstRevisionId: revisionId });
  }

  function fill() {
    return fillBinding({ capturedAgainstRevisionId: revisionId });
  }

  it('stores a binding as a draft and reads it back validated', async () => {
    const created = await repositories().executionBindings.create({
      documentId,
      binding: click(),
    });

    expect(created.state).toBe('draft');
    expect(created.bindingNumber).toBe(1);
    expect(created.stepId).toBe('search_request');
    expect(created.parentBindingId).toBeNull();

    const read = await repositories().executionBindings.findById(created.id);
    expect(read?.binding.body.kind).toBe('click');
    expect(read?.binding.body.target.selectors[0]).toEqual({
      strategy: 'test_id',
      value: 'search-request-button',
    });
  });

  it('refuses to store a binding that does not validate', async () => {
    await expect(
      repositories().executionBindings.create({
        documentId,
        // A CSS selector is not expressible in the closed vocabulary.
        binding: {
          ...click(),
          body: {
            ...click().body,
            target: {
              ...click().body.target,
              selectors: [{ strategy: 'css', value: 'div > button' }],
            },
          },
        } as never,
      }),
    ).rejects.toThrow(/Refusing to store an invalid execution binding/);
  });

  it('detects a binding whose stored bytes were altered out of band', async () => {
    const created = await repositories().executionBindings.create({
      documentId,
      binding: click(),
    });

    // Tamper directly, which nothing in the application can do. Typed rather
    // than raw SQL, and not swallowed: a test whose assertion depends on this
    // write must fail loudly if the write did not happen, instead of reporting
    // a corruption that was never introduced.
    const tampered = await getDatabase()
      .db.update(executionBindings)
      .set({ binding: { ...created.binding, stepId: 'tampered_out_of_band' } })
      .where(eq(executionBindings.id, created.id))
      .returning();

    expect(tampered.length).toBe(1);

    await expect(repositories().executionBindings.findById(created.id)).rejects.toThrow(
      /checksum mismatch/,
    );
  });

  it('supersedes the binding it replaces, in one transaction', async () => {
    const first = await repositories().executionBindings.create({
      documentId,
      binding: click(),
    });

    const second = await repositories().executionBindings.create({
      documentId,
      binding: click(),
      parentBindingId: first.id,
    });

    expect(second.bindingNumber).toBe(2);
    expect(second.parentBindingId).toBe(first.id);

    const parent = await repositories().executionBindings.findById(first.id);
    expect(parent?.state).toBe('superseded');
    expect(parent?.supersededByBindingId).toBe(second.id);

    // The chain is the mapping history, and `findCurrent` follows it.
    const current = await repositories().executionBindings.findCurrent(
      documentId,
      'search_request',
    );
    expect(current?.id).toBe(second.id);
  });

  it('keeps one current binding per step', async () => {
    await repositories().executionBindings.create({ documentId, binding: click() });
    await repositories().executionBindings.create({ documentId, binding: fill() });

    const current = await repositories().executionBindings.listCurrent(documentId);

    expect(current.map((binding) => binding.stepId).sort()).toEqual([
      'enter_request_number',
      'search_request',
    ]);
  });

  it('numbers bindings per step, not per document', async () => {
    await repositories().executionBindings.create({ documentId, binding: click() });
    const otherStep = await repositories().executionBindings.create({
      documentId,
      binding: fill(),
    });

    // A second step's first binding is number 1, not 2.
    expect(otherStep.bindingNumber).toBe(1);
  });

  describe('the review lifecycle', () => {
    it('runs draft to approved through review', async () => {
      const created = await repositories().executionBindings.create({
        documentId,
        binding: click(),
      });

      const inReview = await repositories().executionBindings.submitForReview(created.id);
      expect(inReview.state).toBe('needs_review');

      const approved = await repositories().executionBindings.approve(created.id, {
        reviewNote: 'Confirmed against the sandbox.',
      });

      expect(approved.state).toBe('approved');
      expect(approved.reviewedAt).toBeInstanceOf(Date);
      expect(approved.reviewNote).toBe('Confirmed against the sandbox.');
    });

    it('refuses to approve a binding nobody reviewed', async () => {
      const created = await repositories().executionBindings.create({
        documentId,
        binding: click(),
      });

      // draft -> approved is not a legal edge, and the WHERE clause is what
      // refuses it rather than a prior read.
      await expect(repositories().executionBindings.approve(created.id)).rejects.toThrow(
        /that transition is only allowed from/,
      );
    });

    it('lets a reviewer send a binding back to be re-recorded', async () => {
      const created = await repositories().executionBindings.create({
        documentId,
        binding: click(),
      });

      await repositories().executionBindings.submitForReview(created.id);
      const back = await repositories().executionBindings.returnToDraft(created.id);

      expect(back.state).toBe('draft');
    });

    it('refuses every illegal transition out of a terminal state', async () => {
      const created = await repositories().executionBindings.create({
        documentId,
        binding: click(),
      });
      await repositories().executionBindings.submitForReview(created.id);
      await repositories().executionBindings.reject(created.id, { reviewNote: 'Wrong element.' });

      for (const move of ['submitForReview', 'returnToDraft', 'approve'] as const) {
        await expect(repositories().executionBindings[move](created.id)).rejects.toThrow();
      }
    });
  });

  /**
   * The brief asked whether `SOP_REVISION_TRANSITIONS` could be reused directly
   * for bindings. It cannot, and this is where both vocabularies legitimately
   * exist side by side to record why.
   */
  it('has a lifecycle deliberately distinct from a SOP revision’s', () => {
    const revisionStates = Object.keys(SOP_REVISION_TRANSITIONS);

    // A binding is demonstrated, never asked a question.
    expect(revisionStates).toContain('needs_clarification');
    expect([...BINDING_STATES] as string[]).not.toContain('needs_clarification');
    expect([...BINDING_STATES] as string[]).toContain('needs_review');

    // Reusing the table would have made a binding's state be a revision's
    // state — a type-level coupling of two unrelated entities.
    expect(new Set<string>(BINDING_STATES as readonly BindingState[] as string[])).not.toEqual(
      new Set<string>(revisionStates),
    );
  });
});
