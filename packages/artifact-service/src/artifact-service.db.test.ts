import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  ArtifactIntegrityError,
  createLocalFilesystemArtifactStorage,
  isArtifactStorageKey,
  type ArtifactStorage,
  type PutArtifactResult,
} from '@orbit/artifacts';
import { createTestArtifactRoot, removeTestArtifactRoot } from '@orbit/artifacts/testing';
import { artifactMetadataSchema, type RunId, type RunStepId } from '@orbit/contracts';
import { createRepositories } from '@orbit/db';
import { createTestRun, seedTestAgentVersion, useTestDatabase } from '@orbit/db/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createArtifactService } from './artifact-service';

const testDatabase = useTestDatabase();

let root: string;
let storage: ArtifactStorage;

beforeEach(async () => {
  root = await createTestArtifactRoot();
  storage = await createLocalFilesystemArtifactStorage({ root });
});

afterEach(async () => {
  await removeTestArtifactRoot(root);
});

describe('record — happy path', () => {
  it('writes bytes to disk, inserts one artifacts row, and inserts the given links', async () => {
    const { db } = testDatabase();
    const agentVersion = await seedTestAgentVersion(db);
    const run = await createTestRun(db, agentVersion.id);
    const repositories = createRepositories(db);
    const step = await repositories.runSteps.start({
      runId: run.id,
      agentStepId: 'extract_request_data',
      stepType: 'browser.extract',
    });

    const service = createArtifactService({ storage, database: db });
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);

    const result = await service.record({
      runId: run.id,
      runStepId: step.id,
      kind: 'browser_screenshot',
      bytes,
      links: [
        { targetType: 'run', targetId: run.id, role: 'screenshot_after_action' },
        { targetType: 'run_step', targetId: step.id, role: 'screenshot_after_action' },
      ],
    });

    // Bytes actually landed on disk under the returned storage key.
    const onDisk = await readFile(join(root, result.artifact.storageKey));
    expect(new Uint8Array(onDisk)).toEqual(bytes);

    // Exactly one artifacts row, matching the file.
    const artifactsForRun = await repositories.artifacts.listByRun(run.id);
    expect(artifactsForRun).toHaveLength(1);
    expect(artifactsForRun[0]?.storageKey).toBe(result.artifact.storageKey);
    expect(artifactsForRun[0]?.sizeBytes).toBe(bytes.byteLength);
    expect(artifactsForRun[0]?.sha256).toBe(result.artifact.sha256);

    // Both links were inserted with the given roles and targets.
    expect(result.links).toHaveLength(2);
    const runLinks = await repositories.artifacts.listLinksForRun(run.id);
    expect(runLinks).toHaveLength(1);
    expect(runLinks[0]?.role).toBe('screenshot_after_action');
    expect(runLinks[0]?.targetId).toBe(run.id);

    const stepLinks = await repositories.artifacts.listLinksForStep(step.id);
    expect(stepLinks).toHaveLength(1);
    expect(stepLinks[0]?.role).toBe('screenshot_after_action');
    expect(stepLinks[0]?.targetId).toBe(step.id);

    // The persisted row satisfies the domain contract and its own storage key grammar.
    expect(artifactMetadataSchema.safeParse(result.artifact).success).toBe(true);
    expect(isArtifactStorageKey(result.artifact.storageKey)).toBe(true);

    // read() returns byte-for-byte identical bytes.
    const read = await service.read(result.artifact.id);
    expect(new Uint8Array(read.bytes)).toEqual(bytes);
    expect(read.artifact).toEqual(result.artifact);
  });
});

describe('record — storage failure', () => {
  it('leaves zero artifacts and zero artifact_links rows, and propagates the error', async () => {
    const { db } = testDatabase();
    const agentVersion = await seedTestAgentVersion(db);
    const run = await createTestRun(db, agentVersion.id);
    const repositories = createRepositories(db);

    const thrown = new Error('simulated storage failure');
    const failingStorage: ArtifactStorage = {
      ...storage,
      put: async (): Promise<PutArtifactResult> => {
        throw thrown;
      },
    };
    const service = createArtifactService({ storage: failingStorage, database: db });

    await expect(
      service.record({
        runId: run.id,
        kind: 'browser_screenshot',
        bytes: new Uint8Array([1, 2, 3]),
      }),
    ).rejects.toBe(thrown);

    expect(await repositories.artifacts.listByRun(run.id)).toHaveLength(0);
    expect(await repositories.artifacts.listLinksForRun(run.id)).toHaveLength(0);
  });
});

describe('record — metadata failure', () => {
  it('rolls back the transaction (zero artifacts, zero links) but leaves the bytes on disk', async () => {
    const { db } = testDatabase();
    const repositories = createRepositories(db);

    // Syntactically valid but not seeded: the foreign key rejects the insert.
    const missingRunId = 'run_nonexistent0000000000000000' as RunId;
    const service = createArtifactService({ storage, database: db });
    const bytes = new Uint8Array([9, 9, 9]);

    await expect(
      service.record({ runId: missingRunId, kind: 'browser_screenshot', bytes }),
    ).rejects.toThrow();

    // Nothing was persisted for this (nonexistent) run.
    const rows = await db.query.artifacts.findMany();
    expect(rows).toHaveLength(0);
    const linkRows = await db.query.artifactLinks.findMany();
    expect(linkRows).toHaveLength(0);

    // Documented orphaned-bytes policy: storage.put() already committed the
    // bytes before the metadata transaction ran and failed, and nothing rolls
    // that write back. The file is expected to remain on disk, orphaned.
    const runDir = join(root, 'runs', missingRunId);
    const files = await (await import('node:fs/promises')).readdir(runDir);
    expect(files).toHaveLength(1);
    const onDisk = await readFile(join(runDir, files[0]!));
    expect(new Uint8Array(onDisk)).toEqual(bytes);
    // Also confirm the count didn't come from repositories touching the missing run.
    expect(await repositories.artifacts.listLinksForRun(missingRunId)).toHaveLength(0);
  });
});

describe('record — link failure', () => {
  it('rolls back the artifact row too when a link target does not exist', async () => {
    const { db } = testDatabase();
    const agentVersion = await seedTestAgentVersion(db);
    const run = await createTestRun(db, agentVersion.id);
    const repositories = createRepositories(db);

    const missingRunStepId = 'rstep_nonexistent0000000000000' as RunStepId;
    const service = createArtifactService({ storage, database: db });

    await expect(
      service.record({
        runId: run.id,
        kind: 'browser_screenshot',
        bytes: new Uint8Array([4, 5, 6]),
        links: [
          { targetType: 'run_step', targetId: missingRunStepId, role: 'screenshot_after_action' },
        ],
      }),
    ).rejects.toThrow();

    expect(await repositories.artifacts.listByRun(run.id)).toHaveLength(0);
    expect(await repositories.artifacts.listLinksForRun(run.id)).toHaveLength(0);
  });
});

describe('read — integrity', () => {
  it('throws ArtifactIntegrityError when the bytes on disk no longer match the recorded digest', async () => {
    const { db } = testDatabase();
    const agentVersion = await seedTestAgentVersion(db);
    const run = await createTestRun(db, agentVersion.id);
    const service = createArtifactService({ storage, database: db });

    const result = await service.record({
      runId: run.id,
      kind: 'browser_screenshot',
      bytes: new Uint8Array([1, 2, 3]),
    });

    await writeFile(join(root, result.artifact.storageKey), new Uint8Array([9, 9, 9, 9]));

    await expect(service.read(result.artifact.id)).rejects.toThrow(ArtifactIntegrityError);
  });
});

describe('links queryable through the repositories', () => {
  it('lists links for a run and for a run step with the expected roles', async () => {
    const { db } = testDatabase();
    const agentVersion = await seedTestAgentVersion(db);
    const run = await createTestRun(db, agentVersion.id);
    const repositories = createRepositories(db);
    const step = await repositories.runSteps.start({
      runId: run.id,
      agentStepId: 'submit_request_search',
      stepType: 'browser.click',
    });
    const service = createArtifactService({ storage, database: db });

    await service.record({
      runId: run.id,
      runStepId: step.id,
      kind: 'browser_screenshot',
      bytes: new Uint8Array([1]),
      links: [{ targetType: 'run_step', targetId: step.id, role: 'screenshot_after_action' }],
    });
    await service.record({
      runId: run.id,
      kind: 'browser_trace',
      bytes: new Uint8Array([2]),
      links: [{ targetType: 'run', targetId: run.id, role: 'browser_trace' }],
    });

    const runLinks = await repositories.artifacts.listLinksForRun(run.id);
    expect(runLinks).toHaveLength(1);
    expect(runLinks[0]?.role).toBe('browser_trace');
    expect(runLinks[0]?.targetType).toBe('run');
    expect(runLinks[0]?.targetId).toBe(run.id);

    const stepLinks = await repositories.artifacts.listLinksForStep(step.id);
    expect(stepLinks).toHaveLength(1);
    expect(stepLinks[0]?.role).toBe('screenshot_after_action');
    expect(stepLinks[0]?.targetType).toBe('run_step');
    expect(stepLinks[0]?.targetId).toBe(step.id);
  });
});
