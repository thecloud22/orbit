import {
  createRepositories,
  SOP_REVISION_TRANSITIONS,
  sopGraphRevisions as sopGraphRevisionsTable,
  type OrbitDatabase,
  type SopGraphRevisionRecord,
  type SopRevisionState,
} from '@orbit/db';
import { useTestDatabase } from '@orbit/db/testing';
import {
  createFakeSopProvider,
  respondWith,
  validSopGraphProposal,
} from '@orbit/sop-generation/testing';
import { describeStep, type SopStep } from '@orbit/sop-graph';
import { beforeEach, describe, expect, it } from 'vitest';

import { createSopDraftService } from './draft-service';
import {
  availableActionsFor,
  createSopRevisionService,
  EDITABLE_REVISION_STATES,
  SOP_REVISION_ACTIONS,
  type SopRevisionAction,
} from './revision-service';

/**
 * Review, editing, reorder, clarification and lifecycle against real
 * persistence. Nothing here calls a model: the draft each test starts from is
 * produced by the deterministic fake provider Task 2 built.
 */
describe('SOP revision review', () => {
  const getDatabase = useTestDatabase();

  function services(database: OrbitDatabase) {
    return {
      drafts: createSopDraftService({
        database,
        provider: createFakeSopProvider({ respond: () => respondWith(validSopGraphProposal()) }),
      }),
      revisions: createSopRevisionService({ database }),
    };
  }

  let revision: SopGraphRevisionRecord;

  beforeEach(async () => {
    const created = await services(getDatabase().db).drafts.createDraft({
      kind: 'new_document',
      sourceText: 'Sign in to the portal and review the escalation.',
    });

    if (!created.ok) {
      throw new Error('The fixture draft could not be created.');
    }

    revision = created.revision;
  });

  function service() {
    return services(getDatabase().db).revisions;
  }

  async function countRevisions(): Promise<number> {
    return (await getDatabase().db.select().from(sopGraphRevisionsTable)).length;
  }

  /** Answers every clarification question, which the §4 gate requires. */
  async function answerEveryQuestion(target = revision): Promise<void> {
    for (const question of target.graph.clarificationQuestions) {
      const result = await service().answerQuestion({
        revisionId: target.id,
        questionId: question.id,
        answer: 'Confirmed with the service desk lead.',
      });
      expect(result.ok).toBe(true);
    }
  }

  function editedStep(overrides: Partial<Extract<SopStep, { kind: 'navigate' }>> = {}): SopStep {
    const original = revision.graph.steps.find((step) => step.id === 'open_portal');

    if (original === undefined || original.kind !== 'navigate') {
      throw new Error('The fixture no longer has the navigate step this test edits.');
    }

    return { ...original, ...overrides };
  }

  describe('the review view', () => {
    it('describes every step exactly as describeStep does', async () => {
      const result = await service().reviewDocument(revision.documentId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // No second renderer: the summaries a reviewer reads are the ones
      // @orbit/sop-graph produces, not a copy that could drift from them.
      const summaries = result.review.revision.graph.steps.map(describeStep);
      expect(summaries.length).toBeGreaterThan(5);
      expect(summaries).toContain('Open the service request portal sign-in page');
    });

    it('joins each clarification question to its answer', async () => {
      const question = revision.graph.clarificationQuestions[0];
      expect(question).toBeDefined();

      await service().answerQuestion({
        revisionId: revision.id,
        questionId: question!.id,
        answer: 'A red banner reading "Your password has expired".',
      });

      const result = await service().reviewDocument(revision.documentId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const answered = result.review.clarifications.find((c) => c.questionId === question!.id);
      expect(answered?.answer).toBe('A red banner reading "Your password has expired".');
      expect(answered?.answeredAt).toBeInstanceOf(Date);

      const others = result.review.clarifications.filter((c) => c.questionId !== question!.id);
      expect(others.every((c) => c.answer === null)).toBe(true);
    });

    it('reports a draft as editable and reports what is still unanswered', async () => {
      const result = await service().reviewDocument(revision.documentId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.review.editable).toBe(true);
      expect(result.review.unansweredQuestionIds.length).toBe(
        revision.graph.clarificationQuestions.length,
      );
    });
  });

  describe('editing a step', () => {
    it('supersedes the edited revision with a new one marked as an edit', async () => {
      const result = await service().editStep({
        revisionId: revision.id,
        stepId: 'open_portal',
        step: editedStep({ purpose: 'Open the corrected portal sign-in page' }),
        note: 'The purpose was wrong.',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.revision.revisionNumber).toBe(2);
      expect(result.revision.parentRevisionId).toBe(revision.id);
      expect(result.revision.state).toBe('draft');
      expect(result.revision.provenance.kind).toBe('edited');
      expect(result.revision.provenance.note).toBe('The purpose was wrong.');

      const edited = result.revision.graph.steps.find((step) => step.id === 'open_portal');
      expect(edited === undefined ? '' : describeStep(edited)).toBe(
        'Open the corrected portal sign-in page',
      );

      const parent = await createRepositories(getDatabase().db).sopGraphRevisions.findById(
        revision.id,
      );
      expect(parent?.state).toBe('superseded');
      expect(parent?.supersededByRevisionId).toBe(result.revision.id);
    });

    it('refuses an edit that would make the graph invalid, and writes nothing', async () => {
      const before = await countRevisions();

      const result = await service().editStep({
        revisionId: revision.id,
        stepId: 'enter_request_number',
        // Reads a variable no earlier step produces.
        step: {
          id: 'enter_request_number',
          kind: 'fill',
          fieldHint: 'Request Number',
          value: '${variables.neverProduced}',
          purpose: 'Provide the request number for advanced search',
        },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.reason).toBe('invalid_graph');
      expect(
        result.reason === 'invalid_graph' && result.issues.map((issue) => issue.code),
      ).toContain('UNDECLARED_VARIABLE_REFERENCE');

      await expect(countRevisions()).resolves.toBe(before);
    });

    it('refuses to rename a step id', async () => {
      const result = await service().editStep({
        revisionId: revision.id,
        stepId: 'open_portal',
        step: { ...editedStep(), id: 'renamed_portal' } as SopStep,
      });

      expect(result.ok === false && result.reason).toBe('step_id_immutable');
    });

    it('refuses an edit to a step that does not exist', async () => {
      const result = await service().editStep({
        revisionId: revision.id,
        stepId: 'no_such_step',
        step: { ...editedStep(), id: 'no_such_step' } as SopStep,
      });

      expect(result.ok === false && result.reason).toBe('unknown_step');
    });

    it('refuses to edit a revision that is no longer a draft', async () => {
      await answerEveryQuestion();
      await service().transition({ revisionId: revision.id, action: 'submit_for_review' });

      const result = await service().editStep({
        revisionId: revision.id,
        stepId: 'open_portal',
        step: editedStep({ purpose: 'Edited while under review' }),
      });

      // ADR-017: an in_review revision goes back through request_clarification
      // before it can be edited.
      expect(result.ok === false && result.reason).toBe('not_editable');
    });
  });

  describe('inserting a step', () => {
    const CLICK = {
      kind: 'click',
      targetHint: 'Escalate',
      purpose: 'Escalate the request',
    } as const;

    it('adds the step at the chosen position, as a new revision', async () => {
      const before = await countRevisions();
      const originalIds = revision.graph.steps.map((step) => step.id);

      const result = await service().insertStep({
        revisionId: revision.id,
        index: 1,
        step: CLICK,
        note: 'The desk escalates before searching.',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // A write never changes the revision on screen; it supersedes it.
      expect(await countRevisions()).toBe(before + 1);
      expect(result.revision.id).not.toBe(revision.id);
      expect(result.revision.graph.steps.map((step) => step.id)).toEqual([
        originalIds[0],
        result.stepId,
        ...originalIds.slice(1),
      ]);
    });

    it('generates the id rather than taking one from the caller', async () => {
      const result = await service().insertStep({
        revisionId: revision.id,
        index: 1,
        step: CLICK,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.stepId).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(revision.graph.steps.map((step) => step.id)).not.toContain(result.stepId);
    });

    it('makes a step inserted before the entry the new entry step', async () => {
      // The trap this test exists for. `entryStepId` names the entry step
      // explicitly rather than meaning "whatever is first", so without moving
      // it the inserted step would be silently unreachable and the workflow
      // would still start exactly where it did before.
      const original = revision.graph.entryStepId;
      const entryIndex = revision.graph.steps.findIndex((step) => step.id === original);
      expect(entryIndex).toBe(0);

      const result = await service().insertStep({
        revisionId: revision.id,
        index: 0,
        step: { kind: 'navigate', purpose: 'Open the queue first', urlHint: 'https://example.com' },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.revision.graph.entryStepId).toBe(result.stepId);
      expect(result.revision.graph.steps[0]?.id).toBe(result.stepId);
      // And the step that used to start the workflow is still in it.
      expect(result.revision.graph.steps.map((step) => step.id)).toContain(original);
    });

    it('leaves the entry step alone when inserting anywhere else', async () => {
      const original = revision.graph.entryStepId;

      const result = await service().insertStep({
        revisionId: revision.id,
        index: 2,
        step: CLICK,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.revision.graph.entryStepId).toBe(original);
    });

    it('validates the whole graph, not just the step', async () => {
      // A click appended after the workflow's terminal step leaves the workflow
      // no longer ending on an outcome. That is invisible from the step itself.
      const before = await countRevisions();

      const result = await service().insertStep({
        revisionId: revision.id,
        index: revision.graph.steps.length,
        step: CLICK,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('invalid_graph');
      if (result.reason !== 'invalid_graph') return;
      expect(result.issues.length).toBeGreaterThan(0);
      // Nothing was written: a refused insert is not a revision.
      expect(await countRevisions()).toBe(before);
    });

    it('refuses a position outside the workflow', async () => {
      const result = await service().insertStep({
        revisionId: revision.id,
        index: revision.graph.steps.length + 1,
        step: CLICK,
      });

      expect(result.ok ? null : result.reason).toBe('out_of_range');
    });

    it('refuses to insert into a revision that can no longer be edited', async () => {
      await answerEveryQuestion();
      await service().transition({ revisionId: revision.id, action: 'submit_for_review' });

      const result = await service().insertStep({
        revisionId: revision.id,
        index: 1,
        step: CLICK,
      });

      expect(result.ok ? null : result.reason).toBe('not_editable');
    });

    it('says plainly when the revision does not exist', async () => {
      const result = await service().insertStep({
        revisionId: 'soprev_01hzz0000000000000000000' as never,
        index: 0,
        step: CLICK,
      });

      expect(result.ok ? null : result.reason).toBe('not_found');
    });
  });

  describe('reordering', () => {
    it('supersedes with a new revision when the move is valid', async () => {
      const result = await service().reorderStep({
        revisionId: revision.id,
        move: { stepId: 'enter_date_to', direction: 'up' },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.revision.revisionNumber).toBe(2);
      expect(result.revision.parentRevisionId).toBe(revision.id);
      expect(result.revision.provenance.kind).toBe('edited');

      const order = result.revision.graph.steps.map((step) => step.id);
      expect(order.indexOf('enter_date_to')).toBeLessThan(order.indexOf('enter_date_from'));
    });

    it('rejects a dependency-breaking move with one plain-language sentence, writing nothing', async () => {
      const before = await countRevisions();

      const result = await service().reorderStep({
        revisionId: revision.id,
        move: { stepId: 'search_team_directory', toIndex: 0 },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.reason).toBe('rejected');
      if (result.reason !== 'rejected') return;

      expect(result.explanation).toMatch(/^Cannot move "/);
      expect(result.explanation.endsWith('.')).toBe(true);
      expect(result.issues.length).toBeGreaterThan(0);

      await expect(countRevisions()).resolves.toBe(before);
    });

    it('reports a move past the end of the list without raising', async () => {
      const first = revision.graph.steps[0];
      expect(first).toBeDefined();

      const result = await service().reorderStep({
        revisionId: revision.id,
        move: { stepId: first!.id, direction: 'up' },
      });

      // validateReorder is not total; the service catches ReorderError so this
      // is a typed refusal rather than a 500.
      expect(result.ok === false && result.reason).toBe('out_of_range');
      expect(
        result.ok === false && result.reason === 'out_of_range' && result.explanation,
      ).toContain('cannot move any further');
    });
  });

  describe('clarification answers', () => {
    it('records an answer and returns it with the revision', async () => {
      const question = revision.graph.clarificationQuestions[0]!;

      const recorded = await service().answerQuestion({
        revisionId: revision.id,
        questionId: question.id,
        answer: 'Any status that is not Closed.',
      });

      expect(recorded.ok).toBe(true);

      const answers = await createRepositories(getDatabase().db).sopGraphRevisions.listAnswers(
        revision.id,
      );
      expect(answers.map((answer) => answer.answer)).toContain('Any status that is not Closed.');
    });

    it('refuses a second answer to the same question on the same revision', async () => {
      const question = revision.graph.clarificationQuestions[0]!;

      await service().answerQuestion({
        revisionId: revision.id,
        questionId: question.id,
        answer: 'First answer.',
      });

      const second = await service().answerQuestion({
        revisionId: revision.id,
        questionId: question.id,
        answer: 'Changed my mind.',
      });

      expect(second.ok === false && second.reason).toBe('already_answered');
    });

    /**
     * The pre-check is a read, so it cannot be what enforces the rule. Firing
     * both answers concurrently is what actually exercises the unique
     * constraint and the catch that maps it to the same typed conflict.
     */
    it('refuses a concurrent duplicate through the constraint, not the pre-check', async () => {
      const question = revision.graph.clarificationQuestions[0]!;

      const results = await Promise.all([
        service().answerQuestion({
          revisionId: revision.id,
          questionId: question.id,
          answer: 'Answer from one reviewer.',
        }),
        service().answerQuestion({
          revisionId: revision.id,
          questionId: question.id,
          answer: 'Answer from another reviewer at the same moment.',
        }),
      ]);

      expect(results.filter((result) => result.ok).length).toBe(1);

      const refused = results.find((result) => !result.ok);
      expect(refused === undefined ? '' : !refused.ok && refused.reason).toBe('already_answered');

      const answers = await createRepositories(getDatabase().db).sopGraphRevisions.listAnswers(
        revision.id,
      );
      expect(answers.length).toBe(1);
    });

    it('refuses an answer to a question the revision never asked', async () => {
      const result = await service().answerQuestion({
        revisionId: revision.id,
        questionId: 'question_never_asked',
        answer: 'Whatever.',
      });

      expect(result.ok === false && result.reason).toBe('unknown_question');
    });
  });

  /**
   * §6: an edited URL is exactly as untrusted as a generated one.
   *
   * The spy covers the whole path — the edit, the re-validation, the new
   * revision, and reading it back — because "nothing fetched it" has to hold
   * all the way to the row and out again, not merely during generation.
   */
  describe('the non-network boundary', () => {
    it('stores and re-serves a URL a person typed without ever contacting it', async () => {
      const original = globalThis.fetch;
      const calls: string[] = [];

      globalThis.fetch = ((input: unknown) => {
        calls.push(String(input));
        throw new Error('Nothing in the edit path may contact a URL from a graph.');
      }) as typeof globalThis.fetch;

      try {
        const typed = 'https://internal.example.invalid/a-url-a-reviewer-typed';

        const edited = await service().editStep({
          revisionId: revision.id,
          stepId: 'open_portal',
          step: editedStep({ urlHint: typed, systemHint: 'Some other internal system' }),
          note: 'Corrected the portal address.',
        });

        expect(edited.ok).toBe(true);
        if (!edited.ok) return;

        const stored = edited.revision.graph.steps.find((step) => step.id === 'open_portal');
        expect(stored?.kind === 'navigate' && stored.urlHint).toBe(typed);

        // And again on the way back out, through the review path.
        const reread = await service().reviewRevision(edited.revision.id);
        const served = reread.ok
          ? reread.review.revision.graph.steps.find((step) => step.id === 'open_portal')
          : undefined;
        expect(served?.kind === 'navigate' && served.urlHint).toBe(typed);

        expect(calls).toEqual([]);
      } finally {
        globalThis.fetch = original;
      }
    });

    it('rejects a syntactically invalid URL rather than storing it', async () => {
      const result = await service().editStep({
        revisionId: revision.id,
        stepId: 'open_portal',
        step: editedStep({ urlHint: 'not a url at all' }),
      });

      expect(result.ok).toBe(false);
      expect(
        result.ok === false &&
          result.reason === 'invalid_graph' &&
          result.issues.map((i) => i.code),
      ).toContain('INVALID_URL');
    });
  });

  describe('the review lifecycle', () => {
    it('refuses submit_for_review while any question is unanswered', async () => {
      const result = await service().transition({
        revisionId: revision.id,
        action: 'submit_for_review',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.reason).toBe('questions_unanswered');
      expect(result.reason === 'questions_unanswered' && result.unansweredQuestionIds.length).toBe(
        revision.graph.clarificationQuestions.length,
      );

      const unchanged = await createRepositories(getDatabase().db).sopGraphRevisions.findById(
        revision.id,
      );
      expect(unchanged?.state).toBe('draft');
    });

    it('withholds submit_for_review from the offered actions until every question is answered', async () => {
      const before = await service().reviewDocument(revision.documentId);
      expect(before.ok && before.review.availableActions).not.toContain('submit_for_review');

      await answerEveryQuestion();

      const after = await service().reviewDocument(revision.documentId);
      expect(after.ok && after.review.availableActions).toContain('submit_for_review');
    });

    it('accepts submit_for_review once every question is answered, then approves', async () => {
      await answerEveryQuestion();

      const submitted = await service().transition({
        revisionId: revision.id,
        action: 'submit_for_review',
      });
      expect(submitted.ok && submitted.revision.state).toBe('in_review');

      const approved = await service().transition({
        revisionId: revision.id,
        action: 'approve',
        note: 'Matches the process as described.',
      });

      expect(approved.ok).toBe(true);
      if (!approved.ok) return;

      expect(approved.revision.state).toBe('approved');
      expect(approved.revision.reviewNote).toBe('Matches the process as described.');
      expect(approved.revision.reviewedAt).toBeInstanceOf(Date);
    });

    it('refuses an illegal transition using the repository guard', async () => {
      // draft -> approved is not a legal edge.
      const result = await service().transition({ revisionId: revision.id, action: 'approve' });

      expect(result.ok === false && result.reason).toBe('illegal_transition');
    });

    it('lets a reviewer send an in_review revision back for clarification, then edit it', async () => {
      await answerEveryQuestion();
      await service().transition({ revisionId: revision.id, action: 'submit_for_review' });

      const back = await service().transition({
        revisionId: revision.id,
        action: 'request_clarification',
      });
      expect(back.ok && back.revision.state).toBe('needs_clarification');

      // Which is the whole point of the rule: the route back to editing exists.
      const edited = await service().editStep({
        revisionId: revision.id,
        stepId: 'open_portal',
        step: editedStep({ purpose: 'Open the portal sign-in page, corrected after review' }),
      });

      expect(edited.ok).toBe(true);
    });

    it('offers exactly the actions the transition table permits', async () => {
      await answerEveryQuestion();

      for (const state of Object.keys(SOP_REVISION_TRANSITIONS) as SopRevisionState[]) {
        const offered = availableActionsFor(state, 0);
        const targets = SOP_REVISION_TRANSITIONS[state];

        // Derived from the table rather than listed: a hand-rolled copy would
        // fail this the moment the two disagreed.
        for (const action of SOP_REVISION_ACTIONS) {
          const target = (
            {
              request_clarification: 'needs_clarification',
              submit_for_review: 'in_review',
              approve: 'approved',
              reject: 'rejected',
            } satisfies Record<SopRevisionAction, SopRevisionState>
          )[action];

          expect(offered.includes(action)).toBe(targets.includes(target));
        }

        // `superseded` is a consequence of editing, never an offered action.
        expect(offered).not.toContain('superseded');
      }
    });

    it('permits editing only in the states declared editable', async () => {
      expect([...EDITABLE_REVISION_STATES].sort()).toEqual(['draft', 'needs_clarification']);
    });
  });
});
