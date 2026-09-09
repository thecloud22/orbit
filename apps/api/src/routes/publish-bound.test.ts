import type { PublishBoundDocumentResult } from '@orbit/sop-service';
import { describe, expect, it } from 'vitest';

import { buildServer } from '../app/server';
import { agentVersionRecord } from '../testing/fixtures';
import { createStubContext } from '../testing/stub-context';

/**
 * The one-step bound-workflow-to-agent route, with no database.
 *
 * The claim being checked is that a workflow still missing a binding is told
 * exactly which steps to bind, rather than being walked through approval on
 * the way to a refusal it could not act on.
 */
const DOCUMENT_ID = 'sopdoc_01hzz0000000000000000000';

function server(publish: (documentId: string) => Promise<PublishBoundDocumentResult>) {
  return buildServer({
    context: createStubContext({ publishBoundDocumentService: { publish: publish as never } }),
    logLevel: 'silent',
  });
}

describe('POST /v1/sop-documents/:documentId/publish-bound', () => {
  it('publishes a fully bound workflow and describes the resulting agent', async () => {
    const agentVersion = agentVersionRecord();
    const app = server(() => Promise.resolve({ ok: true, agentVersion }));

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-documents/${DOCUMENT_ID}/publish-bound`,
      payload: {},
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data.agentVersionId).toBe(agentVersion.id);

    await app.close();
  });

  it('names every step still to bind rather than refusing generically', async () => {
    const app = server(() =>
      Promise.resolve({
        ok: false,
        reason: 'not_fully_bound',
        unboundStepIds: ['enter_request_number', 'search'],
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-documents/${DOCUMENT_ID}/publish-bound`,
      payload: {},
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.details.map((detail: { field: string }) => detail.field)).toEqual([
      'enter_request_number',
      'search',
    ]);

    await app.close();
  });

  it('is a 404 for a workflow that does not exist', async () => {
    const app = server(() => Promise.resolve({ ok: false, reason: 'not_found' }));

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-documents/${DOCUMENT_ID}/publish-bound`,
      payload: {},
    });

    expect(response.statusCode).toBe(404);

    await app.close();
  });

  it('carries the compiler’s refusals when compilation could not finish', async () => {
    const app = server(() =>
      Promise.resolve({
        ok: false,
        reason: 'refused',
        refusals: [
          { code: 'BRANCHING_UNSUPPORTED', message: 'A decision step cannot be compiled yet.' },
        ] as never,
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-documents/${DOCUMENT_ID}/publish-bound`,
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.details[0].message).toContain('BRANCHING_UNSUPPORTED');

    await app.close();
  });

  it('reports an already published workflow with the agent it produced', async () => {
    const app = server(() =>
      Promise.resolve({ ok: false, reason: 'already_published', agentVersionId: 'agentv_1' }),
    );

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-documents/${DOCUMENT_ID}/publish-bound`,
      payload: {},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().data.agentVersionId).toBe('agentv_1');

    await app.close();
  });

  it('accepts an empty body, because publishing asks nothing', async () => {
    // The route used to require an outcome mapping. An outcome is now the
    // workflow's own declared name (ADR-030), so there is nothing to send.
    const app = server(() => Promise.resolve({ ok: true, agentVersion: agentVersionRecord() }));

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-documents/${DOCUMENT_ID}/publish-bound`,
      payload: {},
    });

    expect(response.statusCode).not.toBe(400);

    await app.close();
  });
});
