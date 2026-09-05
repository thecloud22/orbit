import {
  createLocalFilesystemArtifactStorage,
  parseArtifactStorageKey,
  type ArtifactStorage,
} from '@orbit/artifacts';
import { createTestArtifactRoot, removeTestArtifactRoot } from '@orbit/artifacts/testing';
import { createArtifactService } from '@orbit/artifact-service';
import type { AgentVersionId } from '@orbit/contracts';
import { createRepositories } from '@orbit/db';
import { seedTestAgentVersion, TEST_TRIGGER, useTestDatabase } from '@orbit/db/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { RunRecorder } from '../ports';
import { createDatabaseRunStore } from './database-run-recorder';

/**
 * The persistence adapter against a real PostgreSQL database and a real
 * filesystem artifact store.
 *
 * Evidence bytes go to a disposable root under the OS temp directory, never to
 * ARTIFACT_STORAGE_DIR: a test must not be able to write into a developer's
 * data/artifacts, and `@orbit/artifacts/testing` refuses to remove any directory
 * it did not create.
 */
describe('createDatabaseRunStore', () => {
  const getDatabase = useTestDatabase();

  let artifactRoot: string;
  let storage: ArtifactStorage;
  let agentVersionId: AgentVersionId;

  beforeEach(async () => {
    artifactRoot = await createTestArtifactRoot();
    storage = await createLocalFilesystemArtifactStorage({ root: artifactRoot });
    agentVersionId = (await seedTestAgentVersion(getDatabase().db)).id;
  });

  afterEach(async () => {
    await removeTestArtifactRoot(artifactRoot);
  });

  async function newRecorder(): Promise<RunRecorder> {
    return createDatabaseRunStore({ database: getDatabase().db, storage }).createRun({
      agentVersionId,
      trigger: TEST_TRIGGER,
      inputs: { requestNumber: 'SR-1001' },
    });
  }

  it('creates a queued run and its run.queued event as one unit of work', async () => {
    const recorder = await newRecorder();
    const repositories = createRepositories(getDatabase().db);

    const run = await repositories.runs.findById(recorder.runId);
    const events = await repositories.runEvents.listByRun(recorder.runId);

    expect(run?.status).toBe('queued');
    expect(run?.agentVersionId).toBe(agentVersionId);
    expect(run?.inputs).toEqual({ requestNumber: 'SR-1001' });
    expect(events.map((event) => event.eventType)).toEqual(['run.queued']);
    expect(events[0]?.sequence).toBe(1);
  });

  it('moves a run through running to succeeded with its outputs', async () => {
    const recorder = await newRecorder();

    await recorder.markRunning();
    expect((await createRepositories(getDatabase().db).runs.findById(recorder.runId))?.status).toBe(
      'running',
    );

    await recorder.completeRun({
      businessOutcome: 'request_found',
      outputs: { requestNumber: 'SR-1001', requestStatus: 'In Progress' },
    });

    const run = await createRepositories(getDatabase().db).runs.findById(recorder.runId);

    expect(run?.status).toBe('succeeded');
    expect(run?.businessOutcome).toBe('request_found');
    expect(run?.outputs).toEqual({ requestNumber: 'SR-1001', requestStatus: 'In Progress' });
    expect(run?.finishedAt).not.toBeNull();
  });

  it('persists a classified failure on the run', async () => {
    const recorder = await newRecorder();
    await recorder.markRunning();

    await recorder.failRun({
      code: 'LOCATOR_NOT_FOUND',
      message: 'The locator was not actionable.',
    });

    const run = await createRepositories(getDatabase().db).runs.findById(recorder.runId);

    expect(run?.status).toBe('failed');
    expect(run?.error).toEqual({
      code: 'LOCATOR_NOT_FOUND',
      message: 'The locator was not actionable.',
    });
    // A technical failure reaches no business conclusion.
    expect(run?.businessOutcome).toBe('none');
  });

  it('persists run steps in execution order with their safe output', async () => {
    const recorder = await newRecorder();
    await recorder.markRunning();

    const first = await recorder.startStep({
      agentStepId: 'open_request_portal',
      stepType: 'browser.navigate',
    });
    await recorder.completeStep(first, { url: 'http://localhost:3001/requests' });

    const second = await recorder.startStep({
      agentStepId: 'enter_request_number',
      stepType: 'browser.fill',
    });
    await recorder.failStep(second, { code: 'LOCATOR_NOT_FOUND', message: 'Not actionable.' });

    const steps = await createRepositories(getDatabase().db).runSteps.listByRun(recorder.runId);

    expect(steps.map((step) => [step.sequence, step.agentStepId, step.status])).toEqual([
      [1, 'open_request_portal', 'succeeded'],
      [2, 'enter_request_number', 'failed'],
    ]);
    expect(steps[0]?.output).toEqual({ url: 'http://localhost:3001/requests' });
    expect(steps[0]?.attempt).toBe(1);
    expect(steps[1]?.error?.code).toBe('LOCATOR_NOT_FOUND');
  });

  it('allocates strictly increasing event sequences', async () => {
    const recorder = await newRecorder();

    await recorder.appendEvent({ eventType: 'run.started', payload: {} });
    const runStepId = await recorder.startStep({
      agentStepId: 'open_request_portal',
      stepType: 'browser.navigate',
    });
    await recorder.appendEvent({
      eventType: 'step.started',
      payload: { stepType: 'browser.navigate' },
      runStepId,
      agentStepId: 'open_request_portal',
    });

    const events = await createRepositories(getDatabase().db).runEvents.listByRun(recorder.runId);
    const sequences = events.map((event) => event.sequence);

    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(new Set(sequences).size).toBe(sequences.length);
    expect(events.at(-1)?.runStepId).toBe(runStepId);
    expect(events.at(-1)?.agentStepId).toBe('open_request_portal');
  });

  it('records a step-scoped artifact with correct metadata, both links, and readable bytes', async () => {
    const recorder = await newRecorder();
    await recorder.markRunning();

    const runStepId = await recorder.startStep({
      agentStepId: 'open_request_portal',
      stepType: 'browser.navigate',
    });
    const bytes = new TextEncoder().encode('<html>evidence</html>');

    const recorded = await recorder.recordArtifact({
      kind: 'dom_snapshot',
      role: 'dom_snapshot',
      bytes,
      runStepId,
      agentStepId: 'open_request_portal',
    });

    const repositories = createRepositories(getDatabase().db);
    const artifact = await repositories.artifacts.findById(recorded.artifactId);

    expect(artifact).not.toBeNull();
    expect(artifact?.kind).toBe('dom_snapshot');
    expect(artifact?.contentType).toBe('text/html; charset=utf-8');
    expect(artifact?.sizeBytes).toBe(bytes.byteLength);
    expect(artifact?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(artifact?.storageKey).toBe(
      `runs/${recorder.runId}/steps/${runStepId}/${recorded.artifactId}.html`,
    );

    const links = await repositories.artifacts.listLinksForArtifact(recorded.artifactId);
    expect(
      links
        .map((link) => [link.targetType, link.targetId, link.role])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ['run_event', recorded.eventId, 'dom_snapshot'],
      ['run_step', runStepId, 'dom_snapshot'],
    ]);

    // The event references the artifact, which is what artifactRefs is derived from.
    const events = await repositories.runEvents.listByRun(recorder.runId);
    const created = events.find((event) => event.id === recorded.eventId);
    expect(created?.eventType).toBe('artifact.created');
    expect(created?.artifactRefs).toEqual([recorded.artifactId]);
    expect(created?.payload).toMatchObject({
      artifactId: recorded.artifactId,
      role: 'dom_snapshot',
    });

    // Bytes come back through Task 5's service, which verifies the digest itself.
    const service = createArtifactService({ database: getDatabase().db, storage });
    const read = await service.read(recorded.artifactId);
    expect(new TextDecoder().decode(read.bytes)).toBe('<html>evidence</html>');
    expect(read.artifact.sha256).toBe(artifact?.sha256);
  });

  it('links a run-scoped artifact such as the trace to the run itself', async () => {
    const recorder = await newRecorder();
    await recorder.markRunning();

    const recorded = await recorder.recordArtifact({
      kind: 'browser_trace',
      role: 'browser_trace',
      bytes: new TextEncoder().encode('trace-zip-bytes'),
    });

    const repositories = createRepositories(getDatabase().db);
    const links = await repositories.artifacts.listLinksForArtifact(recorded.artifactId);

    expect(recorded.contentType).toBe('application/zip');
    expect(recorded.storageKey).toBe(`runs/${recorder.runId}/${recorded.artifactId}.zip`);
    expect(links.map((link) => link.targetType).sort()).toEqual(['run', 'run_event']);
    // Run-scoped evidence belongs to no step.
    expect((await repositories.artifacts.findById(recorded.artifactId))?.runStepId).toBeUndefined();
  });

  it('writes evidence bytes only under the disposable test root', async () => {
    const recorder = await newRecorder();
    await recorder.markRunning();

    const recorded = await recorder.recordArtifact({
      kind: 'browser_screenshot',
      role: 'screenshot_after_action',
      bytes: new TextEncoder().encode('png'),
    });

    expect(await storage.exists(parseArtifactStorageKey(recorded.storageKey))).toBe(true);
    expect(storage.rootDescription).toBe(artifactRoot);
  });
});
