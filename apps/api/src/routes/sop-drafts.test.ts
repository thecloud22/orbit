import { newSopDocumentId, newSopRevisionId } from '@orbit/contracts';
import type { SopDocumentRecord, SopGraphRevisionRecord } from '@orbit/db';
import type { CreateSopDraftInput, CreateSopDraftResult } from '@orbit/sop-service';
import type { SopGraph } from '@orbit/sop-graph';
import { escalationReviewGraph } from '@orbit/sop-graph/testing';
import { describe, expect, it } from 'vitest';

import { buildServer } from '../app/server';
import { createStubContext } from '../testing/stub-context';

/**
 * The draft route with no database and no model.
 *
 * What is asserted here is the contract: which status a caller gets for each
 * outcome, that validation issues survive into the response so a reviewer can
 * act on them, and that a provider's own words never reach the wire.
 */
const DOCUMENT_ID = newSopDocumentId();
const REVISION_ID = newSopRevisionId();

function draftResult(graph: SopGraph = escalationReviewGraph()): CreateSopDraftResult {
  const document: SopDocumentRecord = {
    id: DOCUMENT_ID,
    title: graph.title,
    sourceText: 'Sign in and look up the request.',
    recoveryEnabled: false,
    discardedAt: null,
    createdAt: new Date('2026-09-05T10:00:00.000Z'),
    updatedAt: new Date('2026-09-05T10:00:00.000Z'),
  };

  const revision: SopGraphRevisionRecord = {
    id: REVISION_ID,
    documentId: DOCUMENT_ID,
    revisionNumber: 1,
    graph,
    graphSha256: 'a'.repeat(64),
    state: 'draft',
    provenance: {
      kind: 'generated',
      provider: 'fake',
      model: 'fake-model',
      promptVersion: 'sop-graph-generation@1',
      generatedAt: '2026-09-05T10:00:00.000Z',
    },
    parentRevisionId: null,
    supersededByRevisionId: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: new Date('2026-09-05T10:00:00.000Z'),
    updatedAt: new Date('2026-09-05T10:00:00.000Z'),
  };

  return {
    ok: true,
    document,
    revision,
    generation: {
      provider: 'fake',
      model: 'fake-model',
      promptVersion: 'sop-graph-generation@1',
      generatedAt: '2026-09-05T10:00:00.000Z',
      attempts: 1,
    },
  };
}

function server(result: CreateSopDraftResult, capture?: CreateSopDraftInput[]) {
  return buildServer({
    logLevel: 'silent',
    context: createStubContext({
      sopDraftService: {
        createDraft: (input: CreateSopDraftInput) => {
          capture?.push(input);
          return Promise.resolve(result);
        },
      },
    }),
  });
}

async function post(app: ReturnType<typeof buildServer>, payload: unknown) {
  await app.ready();
  return app.inject({ method: 'POST', url: '/v1/sop-drafts', payload: payload as object });
}

describe('POST /v1/sop-drafts', () => {
  it('creates a draft from source text', async () => {
    const captured: CreateSopDraftInput[] = [];
    const app = server(draftResult(), captured);

    const response = await post(app, { sourceText: 'Sign in and look up the request.' });

    expect(response.statusCode).toBe(201);

    const draft = response.json().data;
    expect(draft.documentId).toBe(DOCUMENT_ID);
    expect(draft.revisionId).toBe(REVISION_ID);
    expect(draft.revisionNumber).toBe(1);
    expect(draft.state).toBe('draft');
    expect(draft.title).toBe('Service request escalation review');
    expect(draft.steps.length).toBeGreaterThan(5);
    expect(draft.provenance).toEqual({
      kind: 'generated',
      provider: 'fake',
      model: 'fake-model',
      promptVersion: 'sop-graph-generation@1',
      generatedAt: '2026-09-05T10:00:00.000Z',
    });

    // Stated by the server rather than assumed by the UI.
    expect(draft.executable).toBe(false);

    expect(captured[0]).toEqual({
      kind: 'new_document',
      sourceText: 'Sign in and look up the request.',
    });

    await app.close();
  });

  it('carries URL hints through as text', async () => {
    const app = server(draftResult());
    const response = await post(app, {
      sourceText: 'Open https://portal.example.com and sign in.',
    });

    // The step summary names the destination; nothing fetched it.
    const summaries = response.json().data.steps.map((step: { summary: string }) => step.summary);
    expect(summaries.join(' ')).toContain('portal');

    await app.close();
  });

  it('requests a new revision when given a document id', async () => {
    const captured: CreateSopDraftInput[] = [];
    const app = server(draftResult(), captured);

    const response = await post(app, { documentId: DOCUMENT_ID });

    expect(response.statusCode).toBe(201);
    expect(captured[0]).toEqual({ kind: 'new_revision', documentId: DOCUMENT_ID });

    await app.close();
  });

  it('refuses source text and a document id together', async () => {
    // Source text has no update path, so "different text for the document you
    // already have" is not a request this API can honour.
    const app = server(draftResult());

    const response = await post(app, { sourceText: 'New text.', documentId: DOCUMENT_ID });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');

    await app.close();
  });

  it('rejects an empty body, empty text, and a malformed document id', async () => {
    for (const payload of [{}, { sourceText: '   ' }, { documentId: 'not-an-orbit-id' }]) {
      const app = server(draftResult());
      const response = await post(app, payload);

      expect(response.statusCode).toBe(400);
      await app.close();
    }
  });

  it('returns 422 with the validation issues when the model produced an unusable graph', async () => {
    const app = server({
      ok: false,
      reason: 'invalid_after_repair',
      issues: [
        {
          code: 'UNKNOWN_ENTRY_STEP',
          message: 'The entry step "no_such_step" does not exist.',
          path: ['entryStepId'],
        },
        {
          code: 'VARIABLE_NOT_AVAILABLE_ON_ALL_PATHS',
          message: 'assignedTeam is not produced on every path.',
          path: ['steps', 7, 'value'],
          stepId: 'search_directory',
        },
      ],
    });

    const response = await post(app, { sourceText: 'Something ambiguous.' });

    expect(response.statusCode).toBe(422);

    const error = response.json().error;
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toContain('Nothing was saved.');
    expect(error.details).toEqual([
      {
        field: 'entryStepId',
        message: '[UNKNOWN_ENTRY_STEP] The entry step "no_such_step" does not exist.',
      },
      {
        field: 'steps.7.value',
        message:
          '[VARIABLE_NOT_AVAILABLE_ON_ALL_PATHS] assignedTeam is not produced on every path.',
      },
    ]);

    await app.close();
  });

  it('never repeats a provider failure message to the caller', async () => {
    const app = server({
      ok: false,
      reason: 'provider_error',
      message: 'x-api-key rejected for account acct_9f3 at api.internal.example',
    });

    const response = await post(app, { sourceText: 'Sign in and look up the request.' });

    expect(response.statusCode).toBe(500);

    const body = response.body;
    expect(body).not.toContain('acct_9f3');
    expect(body).not.toContain('api.internal.example');
    expect(response.json().error.code).toBe('INTERNAL_ERROR');

    await app.close();
  });

  it('returns 404 for a document that does not exist', async () => {
    const app = server({
      ok: false,
      reason: 'document_not_found',
      documentId: DOCUMENT_ID,
    });

    const response = await post(app, { documentId: DOCUMENT_ID });

    expect(response.statusCode).toBe(404);

    await app.close();
  });

  it('publishes no storage key, filesystem path, or raw row', async () => {
    const app = server(draftResult());
    const response = await post(app, { sourceText: 'Sign in and look up the request.' });

    const body = response.body;
    expect(body).not.toContain('storageKey');
    expect(body).not.toContain('graphSha256');
    expect(body).not.toContain('sourceText');
    expect(body).not.toContain('createdAt');
    expect(body).not.toContain('updatedAt');

    await app.close();
  });
});
