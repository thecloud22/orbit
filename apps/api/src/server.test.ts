import { newRunId } from '@orbit/contracts';
import { describe, expect, it } from 'vitest';

import { buildServer } from './server';
import { agentVersionRecord, SEEDED_AGENT_VERSION_ID } from './testing/fixtures';
import { createStubContext, type StubContextOptions } from './testing/stub-context';

/**
 * The HTTP surface with no database and no browser.
 *
 * Everything here is request validation, error shape, and non-leakage — the
 * behaviours that must hold before any persistence is involved. The
 * database-backed behaviours live in `api.db.test.ts`.
 */
function server(options: StubContextOptions = {}) {
  return buildServer({ logLevel: 'silent', context: createStubContext(options) });
}

const VALID_BODY = { inputs: { requestNumber: 'SR-1001' } };

describe('Orbit API', () => {
  it('answers the liveness probe', async () => {
    const app = server();
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });

    await app.close();
  });

  it('returns the structured error envelope for an unknown route', async () => {
    const app = server();
    const response = await app.inject({ method: 'GET', url: '/v1/nope' });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(response.json().error.requestId).toMatch(/^req_/);

    await app.close();
  });
});

describe('GET /v1/agent-versions', () => {
  it('returns the published version with its input schema and no internal fields', async () => {
    const app = server({
      agentVersions: {
        listPublished: async () => [
          {
            id: SEEDED_AGENT_VERSION_ID,
            agentId: agentVersionRecord().agentId,
            name: 'Find Service Request',
            version: '0.1.0',
            description: 'Locate a service request.',
            lifecycleStatus: 'published',
            inputs: agentVersionRecord().agentIr.inputs,
          },
        ],
      },
    });

    const response = await app.inject({ method: 'GET', url: '/v1/agent-versions' });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ id: SEEDED_AGENT_VERSION_ID, version: '0.1.0' });
    expect(body.data[0].inputSchema.requestNumber).toMatchObject({
      type: 'string',
      required: true,
    });
    // The IR itself, and anything about storage, stays server-side.
    expect(body.data[0]).not.toHaveProperty('agentIr');
    expect(body.data[0]).not.toHaveProperty('irSha256');

    await app.close();
  });
});

describe('POST /v1/agent-versions/:agentVersionId/runs', () => {
  function startServer(overrides: StubContextOptions = {}) {
    return server({
      agentVersions: { findById: async () => agentVersionRecord() },
      dispatcher: {
        dispatch: async () => ({ runId: newRunId(), completed: Promise.resolve() }),
      },
      ...overrides,
    });
  }

  it('accepts a valid request and returns a run id without waiting for execution', async () => {
    const app = startServer();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/agent-versions/${SEEDED_AGENT_VERSION_ID}/runs`,
      payload: VALID_BODY,
    });
    const body = response.json();

    expect(response.statusCode).toBe(202);
    expect(body.data.runId).toMatch(/^run_/);
    expect(body.data.status).toBe('queued');
    expect(body.data.businessOutcome).toBe('none');
    expect(body.data.agentVersionId).toBe(SEEDED_AGENT_VERSION_ID);

    await app.close();
  });

  it('rejects a malformed agent version id before any lookup', async () => {
    const app = server();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/agent-versions/not-an-id/runs',
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');

    await app.close();
  });

  it('returns 404 for an agent version that does not exist', async () => {
    const app = server({ agentVersions: { findById: async () => null } });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/agent-versions/${SEEDED_AGENT_VERSION_ID}/runs`,
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');

    await app.close();
  });

  it('rejects a blank request number with field-level input errors', async () => {
    const app = startServer();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/agent-versions/${SEEDED_AGENT_VERSION_ID}/runs`,
      payload: { inputs: { requestNumber: '' } },
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(body.error.code).toBe('INPUT_ERROR');
    expect(body.error.details.map((detail: { field: string }) => detail.field)).toContain(
      'requestNumber',
    );

    await app.close();
  });

  it('rejects a missing required input', async () => {
    const app = startServer();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/agent-versions/${SEEDED_AGENT_VERSION_ID}/runs`,
      payload: { inputs: {} },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INPUT_ERROR');

    await app.close();
  });

  it('rejects an input the Agent Version does not declare', async () => {
    const app = startServer();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/agent-versions/${SEEDED_AGENT_VERSION_ID}/runs`,
      payload: { inputs: { requestNumber: 'SR-1001', sneaky: 'value' } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INPUT_ERROR');

    await app.close();
  });

  it('rejects an unknown field in the request body', async () => {
    const app = startServer();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/agent-versions/${SEEDED_AGENT_VERSION_ID}/runs`,
      payload: { ...VALID_BODY, headless: false },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');

    await app.close();
  });

  it('rejects an unsupported trigger', async () => {
    const app = startServer();

    const response = await app.inject({
      method: 'POST',
      url: `/v1/agent-versions/${SEEDED_AGENT_VERSION_ID}/runs`,
      payload: {
        ...VALID_BODY,
        trigger: { type: 'webhook', actor: { type: 'development_user', id: 'x' } },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');

    await app.close();
  });

  it('refuses to execute a version whose record is not published', async () => {
    const app = server({
      agentVersions: { findById: async () => agentVersionRecord({ lifecycleStatus: 'draft' }) },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/agent-versions/${SEEDED_AGENT_VERSION_ID}/runs`,
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');

    await app.close();
  });

  it('refuses to execute a version whose Agent IR is not published', async () => {
    const base = agentVersionRecord();
    const app = server({
      agentVersions: {
        findById: async () => ({
          ...base,
          agentIr: { ...base.agentIr, lifecycle: { ...base.agentIr.lifecycle, status: 'draft' } },
        }),
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/agent-versions/${SEEDED_AGENT_VERSION_ID}/runs`,
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');

    await app.close();
  });
});

describe('read routes reject malformed identifiers', () => {
  it('rejects a malformed run id', async () => {
    const app = server();
    const response = await app.inject({ method: 'GET', url: '/v1/runs/nope' });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');

    await app.close();
  });

  it('returns 404 for a run that does not exist', async () => {
    const app = server({ runs: { findById: async () => null } });
    const response = await app.inject({ method: 'GET', url: `/v1/runs/${newRunId()}` });

    expect(response.statusCode).toBe(404);

    await app.close();
  });

  it('rejects a malformed artifact id', async () => {
    const app = server();
    const response = await app.inject({
      method: 'GET',
      url: `/v1/runs/${newRunId()}/artifacts/nope`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');

    await app.close();
  });

  it('never reveals a filesystem path or storage key in an error body', async () => {
    const app = server({ runs: { findById: async () => null } });
    const response = await app.inject({ method: 'GET', url: `/v1/runs/${newRunId()}` });
    const body = response.body;

    expect(body).not.toContain('/Users');
    expect(body).not.toContain('data/artifacts');
    expect(body).not.toContain('storageKey');
    expect(body).not.toContain('runs/run_');

    await app.close();
  });
});
