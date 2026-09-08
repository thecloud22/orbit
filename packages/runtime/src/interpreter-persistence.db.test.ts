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

import { executeAgentVersion } from './interpreter';
import { createDatabaseRunStore } from './persistence';
import { createFakeBrowser, createFakeBrowserFactory } from './testing/fakes';
import { loadFixtureAgentIr } from './testing/fixture';

/**
 * The whole interpreter against real persistence, with a fake browser.
 *
 * This is the layer that proves the evidence trail is durable and correctly
 * shaped without needing Chromium — the real-browser proof is a separate
 * project (`pnpm test:runtime`).
 */
describe('executeAgentVersion over real persistence', () => {
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

  async function execute(options: { requestNumber: string; missingTestIds?: readonly string[] }) {
    const browser = createFakeBrowser(
      options.missingTestIds === undefined ? {} : { missingTestIds: options.missingTestIds },
    );

    const result = await executeAgentVersion({
      agentVersionId,
      agentIr: loadFixtureAgentIr(),
      inputs: { requestNumber: options.requestNumber },
      trigger: TEST_TRIGGER,
      store: createDatabaseRunStore({ database: getDatabase().db, storage }),
      executors: { browser: createFakeBrowserFactory(browser) },
    });

    return { result, browser, repositories: createRepositories(getDatabase().db) };
  }

  it('persists one durable succeeded run with its steps, events, outputs, and evidence', async () => {
    const { result, repositories } = await execute({ requestNumber: 'SR-1001' });

    const run = await repositories.runs.findById(result.runId);
    expect(run?.status).toBe('succeeded');
    expect(run?.businessOutcome).toBe('request_found');
    expect(run?.agentVersionId).toBe(agentVersionId);
    expect(run?.outputs).toEqual({
      requestNumber: 'SR-1001',
      requestStatus: 'In Progress',
      assignedTeam: 'Infrastructure Operations',
    });

    const steps = await repositories.runSteps.listByRun(result.runId);
    expect(steps.map((step) => step.agentStepId)).toEqual([
      'open_request_portal',
      'enter_request_number',
      'submit_request_search',
      'detect_request_result',
      'verify_request_number',
      'extract_request_data',
      'complete_found',
    ]);
    expect(steps.every((step) => step.status === 'succeeded')).toBe(true);
    expect(steps.map((step) => step.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);

    const events = await repositories.runEvents.listByRun(result.runId);
    expect(events.at(0)?.eventType).toBe('run.queued');
    expect(events.at(1)?.eventType).toBe('run.started');
    expect(events.at(-1)?.eventType).toBe('run.completed');
    expect(events.map((event) => event.sequence)).toEqual(events.map((_event, index) => index + 1));
  });

  it('persists a screenshot, a DOM snapshot, and a trace whose bytes verify', async () => {
    const { result, repositories } = await execute({ requestNumber: 'SR-1001' });

    const artifacts = await repositories.artifacts.listByRun(result.runId);
    const kinds = artifacts.map((artifact) => artifact.kind);

    expect(kinds).toContain('browser_screenshot');
    expect(kinds).toContain('dom_snapshot');
    expect(kinds.filter((kind) => kind === 'browser_trace')).toHaveLength(1);

    const service = createArtifactService({ database: getDatabase().db, storage });

    for (const artifact of artifacts) {
      expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(artifact.sizeBytes).toBeGreaterThan(0);
      expect(await storage.exists(parseArtifactStorageKey(artifact.storageKey))).toBe(true);

      // read() recomputes the digest and raises rather than returning altered bytes.
      const read = await service.read(artifact.id);
      expect(read.bytes.byteLength).toBe(artifact.sizeBytes);
    }
  });

  it('links every artifact to its run or step and to the event that announced it', async () => {
    const { result, repositories } = await execute({ requestNumber: 'SR-1001' });

    const artifacts = await repositories.artifacts.listByRun(result.runId);

    for (const artifact of artifacts) {
      const links = await repositories.artifacts.listLinksForArtifact(artifact.id);
      const targets = links.map((link) => link.targetType).sort();

      expect(targets).toContain('run_event');
      expect(targets).toContain(artifact.kind === 'browser_trace' ? 'run' : 'run_step');
    }

    const events = await repositories.runEvents.listByRun(result.runId);
    const created = events.filter((event) => event.eventType === 'artifact.created');

    expect(created).toHaveLength(artifacts.length);
    expect(created.every((event) => event.artifactRefs.length === 1)).toBe(true);
  });

  it('persists the not-found path as a business outcome, not a technical failure', async () => {
    const { result, repositories } = await execute({ requestNumber: 'SR-9999' });

    const run = await repositories.runs.findById(result.runId);

    expect(run?.status).toBe('succeeded');
    expect(run?.businessOutcome).toBe('request_not_found');
    expect(run?.error).toBeNull();
    expect(run?.outputs).toEqual({ requestNumber: 'SR-9999' });

    const steps = await repositories.runSteps.listByRun(result.runId);
    expect(steps.map((step) => step.agentStepId)).not.toContain('extract_request_data');

    const artifacts = await repositories.artifacts.listByRun(result.runId);
    expect(artifacts.some((artifact) => artifact.kind === 'browser_trace')).toBe(true);
  });

  it('persists a failed run with a classified error and stops executing steps', async () => {
    const { result, repositories } = await execute({
      requestNumber: 'SR-1001',
      missingTestIds: ['request-status'],
    });

    const run = await repositories.runs.findById(result.runId);
    expect(run?.status).toBe('failed');
    expect(run?.error?.code).toBe('LOCATOR_NOT_FOUND');
    expect(run?.outputs).toBeNull();

    const steps = await repositories.runSteps.listByRun(result.runId);
    expect(steps.at(-1)?.agentStepId).toBe('extract_request_data');
    expect(steps.at(-1)?.status).toBe('failed');
    expect(steps.at(-1)?.error?.code).toBe('LOCATOR_NOT_FOUND');
    // Nothing after the failure ran.
    expect(steps.map((step) => step.agentStepId)).not.toContain('complete_found');

    const events = await repositories.runEvents.listByRun(result.runId);
    expect(events.at(-1)?.eventType).toBe('run.failed');
    expect(events.some((event) => event.eventType === 'step.failed')).toBe(true);
    expect(events.some((event) => event.eventType === 'run.completed')).toBe(false);

    // Best-effort failure evidence, plus the trace, are still persisted.
    const artifacts = await repositories.artifacts.listByRun(result.runId);
    expect(artifacts.some((artifact) => artifact.kind === 'browser_trace')).toBe(true);

    const failedStep = steps.at(-1);
    const failureLinks =
      failedStep === undefined ? [] : await repositories.artifacts.listLinksForStep(failedStep.id);
    expect(failureLinks.map((link) => link.role)).toEqual(['error_context', 'error_context']);
  });

  it('creates exactly one run per execution', async () => {
    const { result, repositories } = await execute({ requestNumber: 'SR-1001' });
    const runs = await repositories.runs.listByAgentVersion(agentVersionId);

    expect(runs).toHaveLength(1);
    expect(runs[0]?.id).toBe(result.runId);
  });
});
