import type { AgentVersionRecord } from '@orbit/db';
import type { PublishResult } from '@orbit/sop-service';
import { describe, expect, it } from 'vitest';

import { buildServer } from '../server';
import { agentVersionRecord } from '../testing/fixtures';
import { createStubContext } from '../testing/stub-context';

/**
 * The publish route with no database.
 *
 * What is asserted is the wire contract: that only an approved candidate
 * publishes, that publishing twice is reported as the thing already existing
 * rather than as a failure, and that the response describes the agent rather
 * than claiming anything changed about the SOP document.
 */
function server(publish: (candidateId: string) => Promise<PublishResult>) {
  return buildServer({
    context: createStubContext({ sopPublishService: { publish: publish as never } }),
    logLevel: 'silent',
  });
}

const CANDIDATE_ID = 'aircand_01hzz0000000000000000000';

function published(): AgentVersionRecord {
  return agentVersionRecord({ publishedFromCandidateId: CANDIDATE_ID as never });
}

describe('POST /v1/agent-ir-candidates/:candidateId/publish', () => {
  it('publishes an approved candidate and describes the agent it made', async () => {
    const app = server(() => Promise.resolve({ ok: true, agentVersion: published() }));
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/agent-ir-candidates/${CANDIDATE_ID}/publish`,
    });

    expect(response.statusCode).toBe(201);

    const body = response.json().data as Record<string, unknown>;
    expect(body['agentVersionId']).toBe(published().id);
    expect(body['publishedFromCandidateId']).toBe(CANDIDATE_ID);

    // The response is about the agent. Nothing here says the document changed,
    // because it did not (ADR-016).
    expect(body).not.toHaveProperty('executable');
    expect(body).not.toHaveProperty('documentId');

    await app.close();
  });

  it('refuses a candidate nobody approved, and says which state it is in', async () => {
    const app = server(() =>
      Promise.resolve({ ok: false, reason: 'not_approved', state: 'compiled' }),
    );

    const response = await app.inject({
      method: 'POST',
      url: `/v1/agent-ir-candidates/${CANDIDATE_ID}/publish`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('compiled');

    await app.close();
  });

  it('reports an already-published candidate as a conflict carrying the existing agent', async () => {
    // Not a failure: the thing the caller wanted exists. Returning the id lets
    // the UI link to it instead of showing an error for a job already done.
    const app = server(() =>
      Promise.resolve({
        ok: false,
        reason: 'already_published',
        agentVersionId: 'agentv_existing',
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: `/v1/agent-ir-candidates/${CANDIDATE_ID}/publish`,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().data.agentVersionId).toBe('agentv_existing');

    await app.close();
  });

  it('reports an unknown candidate as missing', async () => {
    const app = server(() => Promise.resolve({ ok: false, reason: 'not_found' }));

    const response = await app.inject({
      method: 'POST',
      url: `/v1/agent-ir-candidates/${CANDIDATE_ID}/publish`,
    });

    expect(response.statusCode).toBe(404);

    await app.close();
  });

  it('rejects an id that is not a candidate id before reaching the service', async () => {
    const app = server(() => {
      throw new Error('the service must not be called for a malformed id');
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent-ir-candidates/not-an-orbit-id/publish',
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });
});
