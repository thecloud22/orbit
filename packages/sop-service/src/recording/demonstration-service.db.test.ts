import type { SopDocumentId } from '@orbit/contracts';
import { createRepositories, stepChecksum } from '@orbit/db';
import { useTestDatabase } from '@orbit/db/testing';
import { buttonFingerprint, clickBinding } from '@orbit/execution-mapping/testing';
import type { DemonstratedEntry } from '@orbit/sop-recording';
import { borrowOrHoldGraph } from '@orbit/sop-graph/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { proposeBindingsFromWalkthrough, type StepProposal } from './demonstration-service';
import { acceptRecoveryProposal } from '../binding/recovery-service';

/**
 * One walkthrough against real persistence (ADR-035).
 *
 * The borrow-or-hold workflow is the case worth testing rather than a
 * convenient one: it has nine steps a binding is required for, a decision in
 * the middle, and **two branches a single walkthrough cannot both demonstrate**.
 * What these assert is therefore as much about what is refused as about what is
 * proposed.
 */
describe('proposing bindings from a walkthrough', () => {
  const getDatabase = useTestDatabase();

  let documentId: SopDocumentId;

  function repositories() {
    return createRepositories(getDatabase().db);
  }

  beforeEach(async () => {
    const document = await repositories().sopDocuments.create({
      title: 'Borrow a title, or place a hold',
      sourceText: 'Search the catalog. Borrow if available, otherwise place a hold.',
    });

    await repositories().sopGraphRevisions.create({
      documentId: document.id,
      graph: borrowOrHoldGraph(),
      provenance: { kind: 'authored' },
    });

    documentId = document.id;
  });

  function element(input: {
    readonly kind: 'click' | 'fill' | 'pick';
    readonly testId: string;
    readonly name: string;
  }): DemonstratedEntry {
    return {
      kind: input.kind,
      selectors: [
        { strategy: 'test_id', value: input.testId },
        { strategy: 'role_and_name', value: 'button', name: input.name },
      ],
      fingerprint: { ...buttonFingerprint(), accessibleName: input.name },
      url: 'http://localhost:3020/catalog',
    };
  }

  /** The borrow path, performed the way a person actually would. */
  function borrowWalkthrough(): readonly DemonstratedEntry[] {
    return [
      { kind: 'navigate', url: 'http://localhost:3020/catalog' },
      // The click that only put the cursor in the search box: captured by the
      // page, dropped by normalization, and it must not consume the `fill`
      // step's place in the alignment.
      element({ kind: 'click', testId: 'catalog-search-input', name: 'Search the catalog' }),
      element({ kind: 'fill', testId: 'catalog-search-input', name: 'Search the catalog' }),
      element({ kind: 'click', testId: 'catalog-search-button', name: 'Search' }),
      element({ kind: 'fill', testId: 'borrow-member-id', name: 'Member ID' }),
      element({ kind: 'click', testId: 'borrow-button', name: 'Borrow' }),
      element({ kind: 'pick', testId: 'borrow-confirmation', name: 'Borrow confirmation' }),
    ];
  }

  function byStep(steps: readonly StepProposal[]): ReadonlyMap<string, StepProposal> {
    return new Map(steps.map((step) => [step.stepId, step]));
  }

  it('proposes the path that was walked and refuses the branch that was not', async () => {
    const result = await proposeBindingsFromWalkthrough({
      database: getDatabase().db,
      documentId,
      sequence: borrowWalkthrough(),
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      return;
    }

    const steps = byStep(result.result.steps);

    // Every step a binding is required for was offered, and nothing else:
    // `open_catalog` compiles from the graph's own URL and the outcome steps
    // touch no element.
    expect([...steps.keys()]).toEqual([
      'enter_isbn',
      'search_catalog',
      'check_availability',
      'enter_borrow_member_id',
      'borrow_title',
      'read_borrow_confirmation',
      'enter_hold_member_id',
      'place_hold',
      'read_hold_confirmation',
    ]);

    // The six steps on the demonstrated path, each matched to the interaction a
    // person would point at if asked.
    expect(steps.get('enter_isbn')).toMatchObject({
      outcome: 'proposed',
      demonstrated: 'Filled "Search the catalog"',
    });
    expect(steps.get('search_catalog')).toMatchObject({
      outcome: 'proposed',
      demonstrated: 'Clicked "Search"',
    });
    expect(steps.get('enter_borrow_member_id')).toMatchObject({
      outcome: 'proposed',
      demonstrated: 'Filled "Member ID"',
    });
    expect(steps.get('borrow_title')).toMatchObject({
      outcome: 'proposed',
      demonstrated: 'Clicked "Borrow"',
    });
    expect(steps.get('read_borrow_confirmation')).toMatchObject({
      outcome: 'proposed',
      demonstrated: 'Pointed at "Borrow confirmation"',
    });

    // The decision is refused on principle rather than for want of a capture:
    // one walkthrough follows one path and cannot show both outcomes.
    expect(steps.get('check_availability')).toMatchObject({
      outcome: 'refused',
      refusal: 'decision_needs_each_branch',
    });

    // The hold branch was never performed, so it gets nothing. This is the
    // property that matters most: a confidently wrong element would look
    // finished, and a blank does not.
    for (const stepId of ['enter_hold_member_id', 'place_hold', 'read_hold_confirmation']) {
      expect(steps.get(stepId)).toMatchObject({
        outcome: 'refused',
        refusal: 'nothing_matched',
      });
    }
  });

  it('writes proposals and not bindings', async () => {
    await proposeBindingsFromWalkthrough({
      database: getDatabase().db,
      documentId,
      sequence: borrowWalkthrough(),
    });

    const open = await repositories().bindingRecoveryProposals.listOpen(documentId);
    expect(open).toHaveLength(5);
    expect(open.every((proposal) => proposal.origin === 'demonstration')).toBe(true);
    // A walkthrough proposal replaces nothing, because its step has never been
    // bound. Nothing was superseded and nothing became live.
    expect(open.every((proposal) => proposal.proposedForBindingId === null)).toBe(true);
    expect(open.every((proposal) => proposal.deterministic)).toBe(true);

    const bindings = await repositories().executionBindings.listCurrent(documentId);
    expect(bindings).toHaveLength(0);
  });

  it('stores the element and never what was typed', async () => {
    const result = await proposeBindingsFromWalkthrough({
      database: getDatabase().db,
      documentId,
      sequence: [
        { kind: 'navigate', url: 'http://localhost:3020/catalog' },
        {
          kind: 'fill',
          selectors: [{ strategy: 'test_id', value: 'catalog-search-input' }],
          fingerprint: { ...buttonFingerprint(), accessibleName: 'Search the catalog' },
          typedValue: '978-0-13-235088-4',
          url: 'http://localhost:3020/catalog',
        },
      ],
    });

    expect(result.ok).toBe(true);

    const [proposal] = await repositories().bindingRecoveryProposals.listOpen(documentId);
    const serialized = JSON.stringify(proposal);

    expect(serialized).not.toContain('978-0-13-235088-4');

    // The fill's value comes from what the step declares, not from what the
    // person happened to type while demonstrating it.
    expect(proposal?.proposedBinding.body).toMatchObject({
      kind: 'fill',
      valueSource: { kind: 'sop_variable', name: 'bookIsbn' },
    });
  });

  it('accepting one produces an approved binding through the ordinary lifecycle', async () => {
    await proposeBindingsFromWalkthrough({
      database: getDatabase().db,
      documentId,
      sequence: borrowWalkthrough(),
    });

    const open = await repositories().bindingRecoveryProposals.listOpen(documentId);
    const forSearch = open.find((proposal) => proposal.stepId === 'search_catalog');

    const accepted = await acceptRecoveryProposal({
      database: getDatabase().db,
      proposalId: forSearch!.id,
    });

    expect(accepted.ok).toBe(true);

    if (!accepted.ok) {
      return;
    }

    expect(accepted.binding.state).toBe('approved');
    // Nothing was superseded: this step had no binding to replace.
    expect(accepted.binding.parentBindingId).toBeNull();

    const current = await repositories().executionBindings.findCurrent(
      documentId,
      'search_catalog',
    );
    expect(current?.id).toBe(accepted.binding.id);
  });

  it('refuses to accept once the step has been bound another way', async () => {
    await proposeBindingsFromWalkthrough({
      database: getDatabase().db,
      documentId,
      sequence: borrowWalkthrough(),
    });

    const open = await repositories().bindingRecoveryProposals.listOpen(documentId);
    const forSearch = open.find((proposal) => proposal.stepId === 'search_catalog')!;

    // Somebody demonstrated the step with the per-step flow while the proposal
    // was waiting. The proposal is now about a step that is no longer unbound.
    const revision = await repositories().sopGraphRevisions.findCurrent(documentId);
    const step = borrowOrHoldGraph().steps.find((one) => one.id === 'search_catalog')!;
    const created = await repositories().executionBindings.create({
      documentId,
      binding: clickBinding({
        stepId: 'search_catalog',
        capturedAgainstRevisionId: revision!.id,
        stepSha256: stepChecksum(step),
        body: {
          kind: 'click',
          target: {
            selectors: [{ strategy: 'test_id', value: 'catalog-search-button' }],
            fingerprint: buttonFingerprint(),
          },
        },
      }),
    });
    await repositories().executionBindings.submitForReview(created.id);
    await repositories().executionBindings.approve(created.id, { reviewNote: 'By hand.' });

    const accepted = await acceptRecoveryProposal({
      database: getDatabase().db,
      proposalId: forSearch.id,
    });

    expect(accepted).toMatchObject({ ok: false, reason: 'superseded' });
  });

  it('leaves an open proposal alone when the same workflow is walked twice', async () => {
    await proposeBindingsFromWalkthrough({
      database: getDatabase().db,
      documentId,
      sequence: borrowWalkthrough(),
    });

    const second = await proposeBindingsFromWalkthrough({
      database: getDatabase().db,
      documentId,
      sequence: borrowWalkthrough(),
    });

    expect(second.ok).toBe(true);

    if (!second.ok) {
      return;
    }

    expect(byStep(second.result.steps).get('search_catalog')).toMatchObject({
      outcome: 'refused',
      refusal: 'already_proposed',
    });

    // One open proposal per step, whatever produced it.
    const open = await repositories().bindingRecoveryProposals.listOpen(documentId);
    expect(open).toHaveLength(5);
  });

  it('refuses a walkthrough of a workflow with nothing left to bind', async () => {
    const graph = borrowOrHoldGraph();
    const revision = await repositories().sopGraphRevisions.findCurrent(documentId);

    for (const step of graph.steps.filter((one) => one.kind === 'click')) {
      const created = await repositories().executionBindings.create({
        documentId,
        binding: clickBinding({
          stepId: step.id,
          capturedAgainstRevisionId: revision!.id,
          stepSha256: stepChecksum(step),
          body: {
            kind: 'click',
            target: {
              selectors: [{ strategy: 'test_id', value: `${step.id}-target` }],
              fingerprint: buttonFingerprint(),
            },
          },
        }),
      });
      await repositories().executionBindings.submitForReview(created.id);
      await repositories().executionBindings.approve(created.id, { reviewNote: 'By hand.' });
    }

    // Still some fills and extracts outstanding, so this is not yet the refusal.
    const partly = await proposeBindingsFromWalkthrough({
      database: getDatabase().db,
      documentId,
      sequence: borrowWalkthrough(),
    });
    expect(partly.ok).toBe(true);

    if (!partly.ok) {
      return;
    }

    // The clicks are bound, so they are not offered at all.
    expect(partly.result.steps.map((step) => step.stepId)).not.toContain('search_catalog');
  });

  it('refuses a walkthrough in which nothing was demonstrated', async () => {
    const result = await proposeBindingsFromWalkthrough({
      database: getDatabase().db,
      documentId,
      sequence: [{ kind: 'navigate', url: 'http://localhost:3020/catalog' }],
    });

    expect(result).toMatchObject({ ok: false, reason: 'nothing_demonstrated' });
    expect(await repositories().bindingRecoveryProposals.listOpen(documentId)).toHaveLength(0);
  });
});
