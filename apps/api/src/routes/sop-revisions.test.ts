import { newSopDocumentId, newSopRevisionId } from '@orbit/contracts';
import type { SopDocumentRecord, SopGraphRevisionRecord } from '@orbit/db';
import { describeStep, type SopGraph } from '@orbit/sop-graph';
import { escalationReviewGraph } from '@orbit/sop-graph/testing';
import type { RevisionReview, SopRevisionService } from '@orbit/sop-service';
import { describe, expect, it } from 'vitest';

import { buildServer } from '../server';
import { createStubContext } from '../testing/stub-context';

/**
 * The review routes with no database and no model.
 *
 * These assert the wire contract: which status each outcome produces, that a
 * rejected reorder reaches the caller as one readable sentence, and that the
 * plain-language summaries are the ones `describeStep` produced.
 */
const DOCUMENT_ID = newSopDocumentId();
const REVISION_ID = newSopRevisionId();

function review(overrides: Partial<RevisionReview> = {}): RevisionReview {
  const graph: SopGraph = escalationReviewGraph();

  const document: SopDocumentRecord = {
    id: DOCUMENT_ID,
    title: graph.title,
    sourceText: 'Sign in and review the escalation.',
    createdAt: new Date('2026-09-06T09:00:00.000Z'),
    updatedAt: new Date('2026-09-06T09:00:00.000Z'),
  };

  const revision: SopGraphRevisionRecord = {
    id: REVISION_ID,
    documentId: DOCUMENT_ID,
    revisionNumber: 1,
    graph,
    graphSha256: 'a'.repeat(64),
    state: 'draft',
    provenance: { kind: 'generated', provider: 'fake', model: 'fake-model' },
    parentRevisionId: null,
    supersededByRevisionId: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: new Date('2026-09-06T09:00:00.000Z'),
    updatedAt: new Date('2026-09-06T09:00:00.000Z'),
  };

  return {
    document,
    revision,
    clarifications: graph.clarificationQuestions.map((question) => ({
      questionId: question.id,
      question: question.question,
      aboutStepId: question.aboutStepId ?? null,
      options: question.options ?? null,
      answer: null,
      answeredAt: null,
    })),
    unansweredQuestionIds: graph.clarificationQuestions.map((question) => question.id),
    availableActions: ['request_clarification', 'reject'],
    editable: true,
    ...overrides,
  };
}

function server(sopRevisionService: Partial<SopRevisionService>) {
  return buildServer({ logLevel: 'silent', context: createStubContext({ sopRevisionService }) });
}

describe('GET /v1/sop-documents/:documentId', () => {
  it('renders every step with describeStep and nothing else', async () => {
    const app = server({ reviewDocument: () => Promise.resolve({ ok: true, review: review() }) });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: `/v1/sop-documents/${DOCUMENT_ID}` });

    expect(response.statusCode).toBe(200);

    const data = response.json().data;
    const expected = escalationReviewGraph().steps.map(describeStep);

    // The brief's "no second renderer", asserted rather than asserted-about.
    expect(data.steps.map((step: { summary: string }) => step.summary)).toEqual(expected);
    expect(data.steps[0].position).toBe(1);
    expect(data.executable).toBe(false);

    // The first step cannot move up and the last cannot move down, because
    // validateReorder throws rather than explaining those.
    expect(data.steps[0].canMoveUp).toBe(false);
    expect(data.steps[data.steps.length - 1].canMoveDown).toBe(false);

    await app.close();
  });

  it('publishes no storage key, checksum, or source text', async () => {
    const app = server({ reviewDocument: () => Promise.resolve({ ok: true, review: review() }) });
    const response = await app.inject({ method: 'GET', url: `/v1/sop-documents/${DOCUMENT_ID}` });

    expect(response.body).not.toContain('graphSha256');
    expect(response.body).not.toContain('storageKey');
    expect(response.body).not.toContain('Sign in and review the escalation.');

    await app.close();
  });

  it('404s for a document that does not exist', async () => {
    const app = server({
      reviewDocument: () => Promise.resolve({ ok: false, reason: 'not_found' }),
    });
    const response = await app.inject({ method: 'GET', url: `/v1/sop-documents/${DOCUMENT_ID}` });

    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

describe('PATCH /v1/sop-revisions/:revisionId/steps/:stepId', () => {
  const validStep = escalationReviewGraph().steps.find((step) => step.id === 'open_portal');

  it('creates the superseding revision', async () => {
    const app = server({
      editStep: () =>
        Promise.resolve({ ok: true, revision: { ...review().revision, revisionNumber: 2 } }),
    });

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/sop-revisions/${REVISION_ID}/steps/open_portal`,
      payload: { step: validStep, note: 'Corrected the purpose.' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data.revisionNumber).toBe(2);

    await app.close();
  });

  it('returns 422 with the real issues when the edit would break the graph', async () => {
    const app = server({
      editStep: () =>
        Promise.resolve({
          ok: false,
          reason: 'invalid_graph',
          issues: [
            {
              code: 'UNDECLARED_VARIABLE_REFERENCE',
              message: 'neverProduced is not produced by any step.',
              path: ['steps', 6, 'value'],
              stepId: 'enter_request_number',
            },
          ],
        }),
    });

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/sop-revisions/${REVISION_ID}/steps/open_portal`,
      payload: { step: validStep },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.details).toEqual([
      {
        field: 'steps.6.value',
        message: '[UNDECLARED_VARIABLE_REFERENCE] neverProduced is not produced by any step.',
      },
    ]);

    await app.close();
  });

  it('409s when the revision can no longer be edited', async () => {
    const app = server({
      editStep: () => Promise.resolve({ ok: false, reason: 'not_editable', state: 'approved' }),
    });

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/sop-revisions/${REVISION_ID}/steps/open_portal`,
      payload: { step: validStep },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toContain('approved');

    await app.close();
  });

  it('rejects a step body that is not a valid step at all', async () => {
    const app = server({});

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/sop-revisions/${REVISION_ID}/steps/open_portal`,
      payload: { step: { id: 'open_portal', kind: 'teleport' } },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});

describe('POST /v1/sop-revisions/:revisionId/reorder', () => {
  it('returns the rejection as one plain-language sentence', async () => {
    const explanation =
      'Cannot move "Search the team directory for the assigned team" before "Extract request details" because the moved step uses Assigned Team, which is produced later in the workflow.';

    const app = server({
      reorderStep: () =>
        Promise.resolve({
          ok: false,
          reason: 'rejected',
          explanation,
          issues: [
            {
              code: 'VARIABLE_NOT_AVAILABLE_ON_ALL_PATHS',
              message: 'assignedTeam is not available here.',
              path: ['steps', 2],
              stepId: 'search_team_directory',
            },
          ],
        }),
    });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-revisions/${REVISION_ID}/reorder`,
      payload: { move: { stepId: 'search_team_directory', direction: 'up' } },
    });

    expect(response.statusCode).toBe(422);
    // The sentence is the message; issue codes are supporting detail, not the
    // headline.
    expect(response.json().error.message).toBe(explanation);

    await app.close();
  });

  it('reports a move past the end of the list as a 400, not a 500', async () => {
    const app = server({
      reorderStep: () =>
        Promise.resolve({
          ok: false,
          reason: 'out_of_range',
          explanation: 'That step cannot move any further in that direction.',
        }),
    });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-revisions/${REVISION_ID}/reorder`,
      payload: { move: { stepId: 'open_portal', direction: 'up' } },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});

describe('POST /v1/sop-revisions/:revisionId/answers', () => {
  it('records an answer', async () => {
    const app = server({
      answerQuestion: () =>
        Promise.resolve({
          ok: true,
          answer: {
            id: 'sopans_x' as never,
            revisionId: REVISION_ID,
            questionId: 'question_still_open',
            answer: 'Any status that is not Closed.',
            answeredAt: new Date(),
          },
        }),
    });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-revisions/${REVISION_ID}/answers`,
      payload: { questionId: 'question_still_open', answer: 'Any status that is not Closed.' },
    });

    expect(response.statusCode).toBe(201);
    await app.close();
  });

  it('409s on a second answer to the same question', async () => {
    const app = server({
      answerQuestion: () =>
        Promise.resolve({
          ok: false,
          reason: 'already_answered',
          questionId: 'question_still_open',
        }),
    });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-revisions/${REVISION_ID}/answers`,
      payload: { questionId: 'question_still_open', answer: 'Changed my mind.' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toContain('new revision');

    await app.close();
  });

  it('rejects an empty answer', async () => {
    const app = server({});
    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-revisions/${REVISION_ID}/answers`,
      payload: { questionId: 'question_still_open', answer: '   ' },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});

describe('POST /v1/sop-revisions/:revisionId/transitions', () => {
  it('applies a legal action', async () => {
    const app = server({
      transition: () =>
        Promise.resolve({ ok: true, revision: { ...review().revision, state: 'in_review' } }),
    });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-revisions/${REVISION_ID}/transitions`,
      payload: { action: 'submit_for_review' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.state).toBe('in_review');

    await app.close();
  });

  it('refuses review while questions are unanswered, naming them', async () => {
    const app = server({
      transition: () =>
        Promise.resolve({
          ok: false,
          reason: 'questions_unanswered',
          unansweredQuestionIds: ['question_password_expired', 'question_still_open'],
        }),
    });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-revisions/${REVISION_ID}/transitions`,
      payload: { action: 'submit_for_review' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.details.map((d: { field: string }) => d.field)).toEqual([
      'question_password_expired',
      'question_still_open',
    ]);

    await app.close();
  });

  it('409s on an illegal transition', async () => {
    const app = server({
      transition: () =>
        Promise.resolve({
          ok: false,
          reason: 'illegal_transition',
          from: 'draft',
          action: 'approve',
        }),
    });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-revisions/${REVISION_ID}/transitions`,
      payload: { action: 'approve' },
    });

    expect(response.statusCode).toBe(409);
    await app.close();
  });

  it('rejects an action outside the vocabulary', async () => {
    const app = server({});
    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-revisions/${REVISION_ID}/transitions`,
      payload: { action: 'publish' },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
