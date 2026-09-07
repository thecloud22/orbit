import type { PublishRecordingResult } from '@orbit/sop-service';
import { describe, expect, it } from 'vitest';

import { buildServer } from '../server';
import { agentVersionRecord } from '../testing/fixtures';
import { createStubContext } from '../testing/stub-context';

/**
 * The one-step recording-to-agent route, with no database.
 *
 * What matters at this layer is that the wire contract names why, plainly,
 * for every one of the service's refusal reasons — and that a workflow that
 * was not recorded gets sent back to the ordinary review path rather than a
 * generic failure.
 */
const DOCUMENT_ID = 'sopdoc_01hzz0000000000000000000';

function server(
  publish: (documentId: string, mapping: unknown) => Promise<PublishRecordingResult>,
) {
  return buildServer({
    context: createStubContext({ publishRecordingService: { publish: publish as never } }),
    logLevel: 'silent',
  });
}

describe('POST /v1/sop-documents/:documentId/publish-recording', () => {
  it('publishes and describes the resulting agent', async () => {
    const agentVersion = agentVersionRecord();
    const app = server(() => Promise.resolve({ ok: true, agentVersion }));

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-documents/${DOCUMENT_ID}/publish-recording`,
      payload: { outcomeMapping: { completed: 'request_found' } },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data.agentVersionId).toBe(agentVersion.id);

    await app.close();
  });

  it('sends a workflow that was not recorded back to the ordinary review path', async () => {
    const app = server(() => Promise.resolve({ ok: false, reason: 'not_recorded' }));

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-documents/${DOCUMENT_ID}/publish-recording`,
      payload: { outcomeMapping: {} },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('review');

    await app.close();
  });

  it('names the revision state when it cannot be published', async () => {
    const app = server(() =>
      Promise.resolve({ ok: false, reason: 'revision_not_publishable', state: 'rejected' }),
    );

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-documents/${DOCUMENT_ID}/publish-recording`,
      payload: { outcomeMapping: {} },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('rejected');

    await app.close();
  });

  it('reports every compile refusal, naming the step', async () => {
    const app = server(() =>
      Promise.resolve({
        ok: false,
        reason: 'refused',
        refusals: [{ code: 'missing_binding', stepId: 'search', message: 'not mapped yet' }],
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-documents/${DOCUMENT_ID}/publish-recording`,
      payload: { outcomeMapping: {} },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.details[0].field).toBe('search');

    await app.close();
  });

  it('names the sandbox state when a secret blocks it — the hard gate survives', async () => {
    const app = server(() =>
      Promise.resolve({ ok: false, reason: 'not_ready', sandboxState: 'cannot_validate' }),
    );

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-documents/${DOCUMENT_ID}/publish-recording`,
      payload: { outcomeMapping: {} },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('cannot_validate');

    await app.close();
  });

  it('reports an already-published recording as a conflict, not a failure', async () => {
    const app = server(() =>
      Promise.resolve({
        ok: false,
        reason: 'already_published',
        agentVersionId: 'agentv_existing',
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-documents/${DOCUMENT_ID}/publish-recording`,
      payload: { outcomeMapping: {} },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().data.agentVersionId).toBe('agentv_existing');

    await app.close();
  });

  it('reports an unknown document as missing', async () => {
    const app = server(() => Promise.resolve({ ok: false, reason: 'not_found' }));

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-documents/${DOCUMENT_ID}/publish-recording`,
      payload: { outcomeMapping: {} },
    });

    expect(response.statusCode).toBe(404);

    await app.close();
  });

  it('rejects a mapping value that is not a business outcome, before reaching the service', async () => {
    const app = server(() => {
      throw new Error('the service must not be called for an invalid body');
    });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sop-documents/${DOCUMENT_ID}/publish-recording`,
      payload: { outcomeMapping: { completed: 'something_else' } },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });
});
