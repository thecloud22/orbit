import { readdir } from 'node:fs/promises';

import {
  createLocalFilesystemArtifactStorage,
  parseArtifactStorageKey,
  type ArtifactStorage,
} from '@orbit/artifacts';
import { createTestArtifactRoot, removeTestArtifactRoot } from '@orbit/artifacts/testing';
import { createArtifactService } from '@orbit/artifact-service';
import type { AgentIr } from '@orbit/agent-ir';
import { createRepositories } from '@orbit/db';
import { seedTestAgentVersion, TEST_TRIGGER, useTestDatabase } from '@orbit/db/testing';
import { createPlaywrightExecutorFactory } from '@orbit/executor-playwright';
import { executeAgentVersion, type BrowserExecutor } from '@orbit/runtime';
import { createDatabaseRunStore } from '@orbit/runtime/persistence';
import { brokenExtractLocatorAgentIr, loadFixtureAgentIr } from '@orbit/runtime/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { resolveRepositoryArtifactRoot } from './cli/env';

/**
 * The Task 6 proof: the seeded Agent Version executed by a real Chromium against
 * the real demo portal, with real persistence.
 *
 * This is the composition root, so it is where the whole stack — runtime,
 * Playwright executor, repositories, artifact storage — is exercised together.
 * Everything it writes goes to `orbit_test` and a disposable artifact root; the
 * final test proves the development artifact directory was never touched.
 */
describe('Find Service Request against the real demo portal', () => {
  const getDatabase = useTestDatabase();

  let artifactRoot: string;
  let storage: ArtifactStorage;
  let developmentArtifactsBefore: readonly string[];

  beforeAll(async () => {
    developmentArtifactsBefore = await listDevelopmentArtifacts();
  });

  beforeEach(async () => {
    artifactRoot = await createTestArtifactRoot();
    storage = await createLocalFilesystemArtifactStorage({ root: artifactRoot });
  });

  afterEach(async () => {
    await removeTestArtifactRoot(artifactRoot);
  });

  afterAll(async () => {
    expect(await listDevelopmentArtifacts()).toEqual(developmentArtifactsBefore);
  });

  /** Entries under the developer's real artifact root, or none if it does not exist. */
  async function listDevelopmentArtifacts(): Promise<readonly string[]> {
    try {
      return (await readdir(resolveRepositoryArtifactRoot(), { recursive: true })).sort();
    } catch {
      return [];
    }
  }

  async function publish(agentIr: AgentIr) {
    const repositories = createRepositories(getDatabase().db);
    await repositories.agents.upsert({ id: agentIr.id, name: agentIr.name });
    return repositories.agentVersions.create({ agentIr });
  }

  async function execute(options: { readonly agentIr?: AgentIr; readonly requestNumber: string }) {
    const agentVersion =
      options.agentIr === undefined
        ? await seedTestAgentVersion(getDatabase().db)
        : await publish(options.agentIr);

    // Wrapped so the test can prove the browser really was closed afterwards.
    const factory = createPlaywrightExecutorFactory({ headless: true });
    let opened: BrowserExecutor | undefined;

    const result = await executeAgentVersion({
      agentVersionId: agentVersion.id,
      agentIr: agentVersion.agentIr,
      inputs: { requestNumber: options.requestNumber },
      trigger: TEST_TRIGGER,
      store: createDatabaseRunStore({ database: getDatabase().db, storage }),
      browser: {
        async open() {
          opened = await factory.open();
          return opened;
        },
      },
    });

    return {
      result,
      agentVersion,
      opened,
      repositories: createRepositories(getDatabase().db),
    };
  }

  it('executes SR-1001 to succeeded/request_found with the expected outputs', async () => {
    const { result, agentVersion, repositories } = await execute({ requestNumber: 'SR-1001' });

    const run = await repositories.runs.findById(result.runId);

    expect(run?.status).toBe('succeeded');
    expect(run?.businessOutcome).toBe('request_found');
    expect(run?.agentVersionId).toBe(agentVersion.id);
    expect(agentVersion.version).toBe('0.1.0');
    expect(run?.outputs).toEqual({
      requestNumber: 'SR-1001',
      requestStatus: 'In Progress',
      assignedTeam: 'Infrastructure Operations',
    });
    expect(run?.error).toBeNull();

    expect(await repositories.runs.listByAgentVersion(agentVersion.id)).toHaveLength(1);
  });

  it('persists the expected steps and an ordered event timeline', async () => {
    const { result, repositories } = await execute({ requestNumber: 'SR-1001' });

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

    const events = await repositories.runEvents.listByRun(result.runId);
    expect(events.map((event) => event.sequence)).toEqual(events.map((_e, index) => index + 1));
    expect(events.at(0)?.eventType).toBe('run.queued');
    expect(events.at(1)?.eventType).toBe('run.started');
    expect(events.at(-1)?.eventType).toBe('run.completed');
    expect(events.some((event) => event.eventType === 'browser.navigation.completed')).toBe(true);
    expect(events.some((event) => event.eventType === 'browser.extract.completed')).toBe(true);
    expect(events.some((event) => event.eventType === 'assertion.passed')).toBe(true);
  });

  it('persists screenshot, DOM and trace evidence whose bytes read back and verify', async () => {
    const { result, repositories } = await execute({ requestNumber: 'SR-1001' });

    const artifacts = await repositories.artifacts.listByRun(result.runId);
    const service = createArtifactService({ database: getDatabase().db, storage });

    expect(artifacts.filter((a) => a.kind === 'browser_screenshot').length).toBeGreaterThanOrEqual(
      1,
    );
    expect(artifacts.filter((a) => a.kind === 'dom_snapshot').length).toBeGreaterThanOrEqual(1);
    expect(artifacts.filter((a) => a.kind === 'browser_trace')).toHaveLength(1);

    for (const artifact of artifacts) {
      expect(artifact.sizeBytes).toBeGreaterThan(0);
      expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(artifact.storageKey.startsWith(`runs/${result.runId}/`)).toBe(true);
      expect(await storage.exists(parseArtifactStorageKey(artifact.storageKey))).toBe(true);

      // read() recomputes the digest from the stored bytes and raises on a mismatch.
      const read = await service.read(artifact.id);
      expect(read.bytes.byteLength).toBe(artifact.sizeBytes);

      const links = await repositories.artifacts.listLinksForArtifact(artifact.id);
      const targets = links.map((link) => link.targetType).sort();
      expect(targets).toContain('run_event');
      expect(targets).toContain(artifact.kind === 'browser_trace' ? 'run' : 'run_step');
    }

    // Real content, not a placeholder: PNG magic bytes and an HTML document.
    const screenshot = artifacts.find((a) => a.kind === 'browser_screenshot');
    const firstDom = artifacts.find((a) => a.kind === 'dom_snapshot');
    // Artifacts list in creation order, so the last DOM snapshot is the one
    // captured at the terminal step: the final page state.
    const finalDom = artifacts.filter((a) => a.kind === 'dom_snapshot').at(-1);
    const trace = artifacts.find((a) => a.kind === 'browser_trace');

    expect([...(await service.read(screenshot!.id)).bytes.slice(0, 4)]).toEqual([
      0x89, 0x50, 0x4e, 0x47,
    ]);
    expect(new TextDecoder().decode((await service.read(firstDom!.id)).bytes)).toContain(
      'data-testid="request-number-input"',
    );
    expect(new TextDecoder().decode((await service.read(finalDom!.id)).bytes)).toContain(
      'data-testid="request-status"',
    );
    expect([...(await service.read(trace!.id)).bytes.slice(0, 2)]).toEqual([0x50, 0x4b]);
    expect(trace?.contentType).toBe('application/zip');
  });

  it('executes SR-9999 to succeeded/request_not_found without a technical error', async () => {
    const { result, repositories } = await execute({ requestNumber: 'SR-9999' });

    const run = await repositories.runs.findById(result.runId);

    expect(run?.status).toBe('succeeded');
    expect(run?.businessOutcome).toBe('request_not_found');
    expect(run?.error).toBeNull();
    expect(run?.outputs).toEqual({ requestNumber: 'SR-9999' });

    const steps = await repositories.runSteps.listByRun(result.runId);
    expect(steps.map((step) => step.agentStepId)).toEqual([
      'open_request_portal',
      'enter_request_number',
      'submit_request_search',
      'detect_request_result',
      'complete_not_found',
    ]);

    const artifacts = await repositories.artifacts.listByRun(result.runId);
    expect(artifacts.some((artifact) => artifact.kind === 'browser_trace')).toBe(true);
  });

  it('fails a broken locator with a typed error, evidence, and no later steps', async () => {
    const { result, opened, repositories } = await execute({
      agentIr: brokenExtractLocatorAgentIr(),
      requestNumber: 'SR-1001',
    });

    const run = await repositories.runs.findById(result.runId);

    expect(run?.status).toBe('failed');
    expect(run?.error?.code).toBe('LOCATOR_NOT_FOUND');
    expect(run?.outputs).toBeNull();
    expect(run?.businessOutcome).toBe('none');

    const steps = await repositories.runSteps.listByRun(result.runId);
    expect(steps.at(-1)?.agentStepId).toBe('extract_request_data');
    expect(steps.at(-1)?.status).toBe('failed');
    expect(steps.at(-1)?.error?.code).toBe('LOCATOR_NOT_FOUND');
    expect(steps.map((step) => step.agentStepId)).not.toContain('complete_found');

    const events = await repositories.runEvents.listByRun(result.runId);
    expect(events.at(-1)?.eventType).toBe('run.failed');
    expect(events.some((event) => event.eventType === 'step.failed')).toBe(true);
    expect(events.some((event) => event.eventType === 'run.completed')).toBe(false);

    // Best-effort failure evidence for the failing step, plus the run trace.
    const failedStep = steps.at(-1)!;
    const failureLinks = await repositories.artifacts.listLinksForStep(failedStep.id);
    expect(failureLinks.map((link) => link.role).sort()).toEqual([
      'error_context',
      'error_context',
    ]);

    const artifacts = await repositories.artifacts.listByRun(result.runId);
    expect(artifacts.some((artifact) => artifact.kind === 'browser_trace')).toBe(true);

    // The persisted message is Orbit's own; Playwright's call log, which embeds
    // page state, must never reach the database.
    expect(run?.error?.message).not.toContain('call log');
    expect(run?.error?.message).not.toContain('waiting for');

    // The browser really was closed.
    expect(opened).toBeDefined();
    await expect(opened!.captureScreenshot()).rejects.toThrow();
  });

  it('never seeds a fixture the portal cannot satisfy: the broken agent is the only broken thing', async () => {
    const broken = brokenExtractLocatorAgentIr();

    expect(broken.id).not.toBe(loadFixtureAgentIr().id);
    expect(broken.version).toBe('9.9.9');
    expect(JSON.stringify(broken)).toContain('request-status-does-not-exist');
  });
});
