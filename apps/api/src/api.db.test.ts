import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createLocalFilesystemArtifactStorage, type ArtifactStorage } from '@orbit/artifacts';
import { createTestArtifactRoot, removeTestArtifactRoot } from '@orbit/artifacts/testing';
import { createArtifactService } from '@orbit/artifact-service';
import { newArtifactId, type AgentVersionId, type RunId } from '@orbit/contracts';
import { createRepositories } from '@orbit/db';
import { seedTestAgentVersion, useTestDatabase } from '@orbit/db/testing';
import { createFakeBrowser, createFakeBrowserFactory } from '@orbit/runtime/testing';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createInProcessRunDispatcher } from './dispatch';
import { buildServer } from './server';

/**
 * The API against real persistence and real artifact storage.
 *
 * The browser is the one thing faked: these tests are about HTTP behaviour,
 * linkage enforcement, and integrity, and the real-browser proof lives in the
 * Watchtower end-to-end test. The dispatcher itself is the production one, so
 * the run-id observation path is exercised rather than simulated.
 */
describe('Orbit API over real persistence', () => {
  const getDatabase = useTestDatabase();

  let artifactRoot: string;
  let storage: ArtifactStorage;
  let agentVersionId: AgentVersionId;
  let app: FastifyInstance;

  beforeEach(async () => {
    artifactRoot = await createTestArtifactRoot();
    storage = await createLocalFilesystemArtifactStorage({ root: artifactRoot });
    agentVersionId = (await seedTestAgentVersion(getDatabase().db)).id;

    app = buildServer({
      logLevel: 'silent',
      context: {
        repositories: createRepositories(getDatabase().db),
        artifactService: createArtifactService({ database: getDatabase().db, storage }),
        dispatcher: createInProcessRunDispatcher({
          database: getDatabase().db,
          storage,
          logger: { debug: () => undefined, info: () => undefined, warn: () => undefined },
          browser: createFakeBrowserFactory(() => Promise.resolve(createFakeBrowser())),
        }),
      },
    });

    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await removeTestArtifactRoot(artifactRoot);
  });

  /** Starts a run through the API and waits for it to reach a terminal state. */
  async function runToCompletion(requestNumber: string): Promise<RunId> {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/agent-versions/${agentVersionId}/runs`,
      payload: { inputs: { requestNumber } },
    });

    expect(response.statusCode).toBe(202);
    const runId = response.json().data.runId as RunId;

    const repositories = createRepositories(getDatabase().db);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const run = await repositories.runs.findById(runId);
      if (run !== null && (run.status === 'succeeded' || run.status === 'failed')) {
        return runId;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    throw new Error(`Run ${runId} did not reach a terminal state.`);
  }

  it('lists the seeded published agent version', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/agent-versions' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([
      expect.objectContaining({
        id: agentVersionId,
        name: 'Find Service Request',
        version: '0.1.0',
      }),
    ]);
  });

  it('starts a run and returns its id before execution finishes', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/agent-versions/${agentVersionId}/runs`,
      payload: { inputs: { requestNumber: 'SR-1001' } },
    });

    expect(response.statusCode).toBe(202);
    const runId = response.json().data.runId as RunId;

    // The run is durable the moment the response is sent.
    const run = await createRepositories(getDatabase().db).runs.findById(runId);
    expect(run).not.toBeNull();
    expect(run?.agentVersionId).toBe(agentVersionId);

    await runToCompletion('SR-1001');
  });

  it('serves run detail from persisted state with ordered steps and events', async () => {
    const runId = await runToCompletion('SR-1001');
    const response = await app.inject({ method: 'GET', url: `/v1/runs/${runId}` });
    const run = response.json().data;

    expect(response.statusCode).toBe(200);
    expect(run.status).toBe('succeeded');
    expect(run.businessOutcome).toBe('request_found');
    expect(run.outputs).toEqual({
      requestNumber: 'SR-1001',
      requestStatus: 'In Progress',
      assignedTeam: 'Infrastructure Operations',
    });
    expect(run.error).toBeNull();
    expect(run.agentVersion).toMatchObject({ id: agentVersionId, version: '0.1.0' });

    expect(run.steps.map((step: { agentStepId: string }) => step.agentStepId)).toEqual([
      'open_request_portal',
      'enter_request_number',
      'submit_request_search',
      'detect_request_result',
      'verify_request_number',
      'extract_request_data',
      'complete_found',
    ]);
    expect(run.steps.map((step: { sequence: number }) => step.sequence)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);

    const sequences = run.events.map((event: { sequence: number }) => event.sequence);
    expect(sequences).toEqual([...sequences].sort((a: number, b: number) => a - b));
    expect(run.events.at(0).eventType).toBe('run.queued');
    expect(run.events.at(-1).eventType).toBe('run.completed');
  });

  it('never exposes storage keys or filesystem paths in run detail', async () => {
    const runId = await runToCompletion('SR-1001');
    const body = (await app.inject({ method: 'GET', url: `/v1/runs/${runId}` })).body;

    expect(body).not.toContain('storageKey');
    expect(body).not.toContain(artifactRoot);
    expect(body).not.toContain('/steps/rstep_');
    expect(body).not.toContain('.png"');

    // The artifact.created events still carry their safe detail.
    const run = JSON.parse(body).data;
    const created = run.events.find(
      (event: { eventType: string }) => event.eventType === 'artifact.created',
    );
    expect(created.payload).toHaveProperty('artifactId');
    expect(created.payload).toHaveProperty('sha256');
    expect(created.payload).not.toHaveProperty('storageKey');
  });

  it('exposes artifacts by controlled url with their roles', async () => {
    const runId = await runToCompletion('SR-1001');
    const run = (await app.inject({ method: 'GET', url: `/v1/runs/${runId}` })).json().data;

    expect(run.artifacts.length).toBeGreaterThan(0);

    for (const artifact of run.artifacts) {
      expect(artifact).not.toHaveProperty('storageKey');
      expect(artifact.url).toBe(`/v1/runs/${runId}/artifacts/${artifact.id}`);
      expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(artifact.roles.length).toBeGreaterThan(0);
    }

    expect(run.artifacts.some((a: { kind: string }) => a.kind === 'browser_trace')).toBe(true);
  });

  it('serves artifact bytes with the stored content type and integrity headers', async () => {
    const runId = await runToCompletion('SR-1001');
    const run = (await app.inject({ method: 'GET', url: `/v1/runs/${runId}` })).json().data;

    const screenshot = run.artifacts.find((a: { kind: string }) => a.kind === 'browser_screenshot');
    const trace = run.artifacts.find((a: { kind: string }) => a.kind === 'browser_trace');

    const image = await app.inject({ method: 'GET', url: screenshot.url });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.headers['content-disposition']).toContain('inline');
    expect(image.headers['x-content-type-options']).toBe('nosniff');
    expect(image.headers['x-orbit-sha256']).toBe(screenshot.sha256);
    expect(image.rawPayload.byteLength).toBe(screenshot.sizeBytes);

    // Anything that is not an image is an attachment, so a captured page can
    // never be rendered on the API's own origin.
    const zip = await app.inject({ method: 'GET', url: trace.url });
    expect(zip.statusCode).toBe(200);
    expect(zip.headers['content-type']).toBe('application/zip');
    expect(zip.headers['content-disposition']).toContain('attachment');
    expect(zip.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('serves a DOM snapshot as an attachment, never inline', async () => {
    const runId = await runToCompletion('SR-1001');
    const run = (await app.inject({ method: 'GET', url: `/v1/runs/${runId}` })).json().data;
    const dom = run.artifacts.find((a: { kind: string }) => a.kind === 'dom_snapshot');

    const response = await app.inject({ method: 'GET', url: dom.url });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.headers['content-security-policy']).toContain('sandbox');
  });

  it('refuses an artifact that belongs to a different run', async () => {
    const firstRunId = await runToCompletion('SR-1001');
    const secondRunId = await runToCompletion('SR-9999');

    const first = (await app.inject({ method: 'GET', url: `/v1/runs/${firstRunId}` })).json().data;
    const artifactId = first.artifacts[0].id;

    const response = await app.inject({
      method: 'GET',
      url: `/v1/runs/${secondRunId}/artifacts/${artifactId}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain(artifactRoot);
  });

  it('returns the same 404 for an artifact that does not exist', async () => {
    const runId = await runToCompletion('SR-1001');

    const response = await app.inject({
      method: 'GET',
      url: `/v1/runs/${runId}/artifacts/${newArtifactId()}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.message).toBe('No such artifact for this run.');
  });

  it('refuses to serve evidence whose bytes no longer match their digest', async () => {
    const runId = await runToCompletion('SR-1001');
    const run = (await app.inject({ method: 'GET', url: `/v1/runs/${runId}` })).json().data;
    const dom = run.artifacts.find((a: { kind: string }) => a.kind === 'dom_snapshot');

    // Tamper on disk, which the API cannot do and a caller cannot reach: the
    // storage key comes from the database, not from the API surface.
    const stored = await createRepositories(getDatabase().db).artifacts.findById(dom.id);
    const path = join(artifactRoot, stored!.storageKey);
    const original = await readFile(path);
    await writeFile(path, Buffer.concat([original, Buffer.from('<!-- tampered -->')]));

    const response = await app.inject({ method: 'GET', url: dom.url });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe('ARTIFACT_STORAGE_ERROR');
    expect(response.body).not.toContain(artifactRoot);
  });

  it('returns ordered events, and only newer ones when asked', async () => {
    const runId = await runToCompletion('SR-1001');

    const all = (await app.inject({ method: 'GET', url: `/v1/runs/${runId}/events` })).json().data;
    expect(all.length).toBeGreaterThan(5);
    expect(all.at(0).sequence).toBe(1);

    const since = (
      await app.inject({ method: 'GET', url: `/v1/runs/${runId}/events?afterSequence=5` })
    ).json().data;

    expect(since.every((event: { sequence: number }) => event.sequence > 5)).toBe(true);
    expect(since.length).toBe(all.length - 5);
  });

  it('serves a lightweight status summary for polling', async () => {
    const runId = await runToCompletion('SR-1001');
    const response = await app.inject({ method: 'GET', url: `/v1/runs/${runId}/summary` });
    const summary = response.json().data;

    expect(summary.status).toBe('succeeded');
    expect(summary.businessOutcome).toBe('request_found');
    expect(summary).not.toHaveProperty('events');
    expect(summary).not.toHaveProperty('artifacts');
  });

  it('records the not-found path as a business outcome, not an error', async () => {
    const runId = await runToCompletion('SR-9999');
    const run = (await app.inject({ method: 'GET', url: `/v1/runs/${runId}` })).json().data;

    expect(run.status).toBe('succeeded');
    expect(run.businessOutcome).toBe('request_not_found');
    expect(run.error).toBeNull();
    expect(run.outputs).toEqual({ requestNumber: 'SR-9999' });
  });

  /**
   * The documented Phase 1 limitation: nothing server-side prevents a second
   * concurrent dispatch. Watchtower disables its button while a request is in
   * flight, which is a UI guard, not a server guarantee.
   */
  it('creates a separate run per dispatch, with no server-side duplicate suppression', async () => {
    const [first, second] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/v1/agent-versions/${agentVersionId}/runs`,
        payload: { inputs: { requestNumber: 'SR-1001' } },
      }),
      app.inject({
        method: 'POST',
        url: `/v1/agent-versions/${agentVersionId}/runs`,
        payload: { inputs: { requestNumber: 'SR-1001' } },
      }),
    ]);

    expect(first.json().data.runId).not.toBe(second.json().data.runId);
    expect(
      (await createRepositories(getDatabase().db).runs.listByAgentVersion(agentVersionId)).length,
    ).toBe(2);
  });
});
