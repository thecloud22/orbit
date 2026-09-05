import { newArtifactId, newRunId, newRunStepId } from '@orbit/contracts';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ArtifactAlreadyExistsError,
  ArtifactNotFoundError,
  InvalidStorageKeyError,
} from './errors';
import { createLocalFilesystemArtifactStorage } from './local-filesystem-storage';
import type { ArtifactStorage } from './storage';
import { buildArtifactStorageKey, type ArtifactStorageKey } from './storage-key';
import { createTestArtifactRoot, removeTestArtifactRoot } from './testing/test-root';

/**
 * Whether this platform allows creating symlinks in a temp directory without
 * elevated privileges. Determined once, synchronously, before tests are
 * collected, so the affected suite can be skipped rather than failing on
 * platforms (e.g. Windows without Developer Mode) that refuse the syscall.
 */
function detectSymlinkSupport(): boolean {
  const probeDir = mkdtempSync(join(tmpdir(), 'orbit-symlink-probe-'));
  try {
    const target = join(probeDir, 'target');
    writeFileSync(target, 'x');
    symlinkSync(target, join(probeDir, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
}

const SYMLINKS_SUPPORTED = detectSymlinkSupport();

async function listFilesRecursively(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(full)));
    } else {
      files.push(full);
    }
  }

  return files;
}

const NON_ASCII_BYTES = Uint8Array.from([0, 1, 255, 128, 0, 42]);

describe('local filesystem artifact storage', () => {
  let root: string;
  let storage: ArtifactStorage;

  beforeEach(async () => {
    root = await createTestArtifactRoot();
    storage = await createLocalFilesystemArtifactStorage({ root });
  });

  afterEach(async () => {
    await removeTestArtifactRoot(root);
  });

  it('round-trips bytes containing NUL and high-value bytes exactly', async () => {
    const key = buildArtifactStorageKey({
      runId: newRunId(),
      artifactId: newArtifactId(),
      kind: 'browser_screenshot',
    });

    await storage.put({ key, bytes: NON_ASCII_BYTES, contentType: 'image/png' });
    const result = await storage.get(key);

    expect(Buffer.from(result.bytes)).toEqual(Buffer.from(NON_ASCII_BYTES));
  });

  it('put() returns the size, digest, content type, and key of what was written', async () => {
    const key = buildArtifactStorageKey({
      runId: newRunId(),
      artifactId: newArtifactId(),
      kind: 'browser_screenshot',
    });

    const result = await storage.put({ key, bytes: NON_ASCII_BYTES, contentType: 'image/png' });

    expect(result.sizeBytes).toBe(NON_ASCII_BYTES.byteLength);
    expect(result.sha256).toBe(createHash('sha256').update(NON_ASCII_BYTES).digest('hex'));
    expect(result.contentType).toBe('image/png');
    expect(result.key).toBe(key);
  });

  it('get() returns the same digest and size as put()', async () => {
    const key = buildArtifactStorageKey({
      runId: newRunId(),
      artifactId: newArtifactId(),
      kind: 'extracted_json',
    });

    const putResult = await storage.put({
      key,
      bytes: NON_ASCII_BYTES,
      contentType: 'application/json',
    });
    const getResult = await storage.get(key);

    expect(getResult.sha256).toBe(putResult.sha256);
    expect(getResult.sizeBytes).toBe(putResult.sizeBytes);
  });

  it('exists() is false before a put and true after', async () => {
    const key = buildArtifactStorageKey({
      runId: newRunId(),
      artifactId: newArtifactId(),
      kind: 'error_context',
    });

    expect(await storage.exists(key)).toBe(false);

    await storage.put({ key, bytes: NON_ASCII_BYTES, contentType: 'application/json' });

    expect(await storage.exists(key)).toBe(true);
  });

  it('rejects an invalid key before creating any file', async () => {
    // A key that satisfies the ArtifactStorageKey type only through a cast —
    // exactly the "reached through a cast" case resolveDestination re-validates.
    const invalidKey = 'runs/../etc/passwd' as unknown as ArtifactStorageKey;

    await expect(
      storage.put({ key: invalidKey, bytes: NON_ASCII_BYTES, contentType: 'application/json' }),
    ).rejects.toThrow(InvalidStorageKeyError);

    expect(await listFilesRecursively(root)).toEqual([]);
  });

  it('rejects a second put() to the same key and leaves the original bytes unchanged', async () => {
    const key = buildArtifactStorageKey({
      runId: newRunId(),
      artifactId: newArtifactId(),
      kind: 'browser_screenshot',
    });

    await storage.put({ key, bytes: NON_ASCII_BYTES, contentType: 'image/png' });

    await expect(
      storage.put({ key, bytes: Uint8Array.from([9, 9, 9]), contentType: 'image/png' }),
    ).rejects.toThrow(ArtifactAlreadyExistsError);

    const stillStored = await storage.get(key);
    expect(Buffer.from(stillStored.bytes)).toEqual(Buffer.from(NON_ASCII_BYTES));
  });

  it('get() throws ArtifactNotFoundError for a never-written key', async () => {
    const key = buildArtifactStorageKey({
      runId: newRunId(),
      artifactId: newArtifactId(),
      kind: 'browser_screenshot',
    });

    await expect(storage.get(key)).rejects.toThrow(ArtifactNotFoundError);
  });

  it('creates nested directories for a step-scoped key', async () => {
    const runId = newRunId();
    const runStepId = newRunStepId();
    const key = buildArtifactStorageKey({
      runId,
      runStepId,
      artifactId: newArtifactId(),
      kind: 'dom_snapshot',
    });

    await storage.put({ key, bytes: NON_ASCII_BYTES, contentType: 'text/html; charset=utf-8' });

    const stepDirEntries = await readdir(join(root, 'runs', runId, 'steps', runStepId));
    expect(stepDirEntries).toHaveLength(1);
  });

  it('leaves no temporary file behind after a successful put', async () => {
    const key = buildArtifactStorageKey({
      runId: newRunId(),
      artifactId: newArtifactId(),
      kind: 'browser_trace',
    });

    await storage.put({ key, bytes: NON_ASCII_BYTES, contentType: 'application/zip' });

    const files = await listFilesRecursively(root);
    expect(files.some((file) => /^\.orbit-tmp-/.test(basename(file)))).toBe(false);
  });

  it('rootDescription is the resolved absolute root', async () => {
    expect(storage.rootDescription).toBe(await realpath(root));
  });

  describe.skipIf(!SYMLINKS_SUPPORTED)('symlink containment', () => {
    // Skipped automatically on platforms that refuse to create symlinks
    // without elevated privileges (e.g. Windows outside Developer Mode).

    it('does not follow a symlink at a destination path; put() fails and the target is unchanged', async () => {
      const outsideRoot = await createTestArtifactRoot();
      try {
        const outsideTarget = join(outsideRoot, 'outside-target.png');
        const originalBytes = Uint8Array.from([1, 2, 3]);
        await writeFile(outsideTarget, originalBytes);

        const key = buildArtifactStorageKey({
          runId: newRunId(),
          artifactId: newArtifactId(),
          kind: 'browser_screenshot',
        });
        const destination = join(root, key);
        await mkdir(dirname(destination), { recursive: true });
        await symlink(outsideTarget, destination);

        await expect(
          storage.put({ key, bytes: Uint8Array.from([9, 9, 9]), contentType: 'image/png' }),
        ).rejects.toThrow(ArtifactAlreadyExistsError);

        const afterBytes = await readFile(outsideTarget);
        expect(Buffer.from(afterBytes)).toEqual(Buffer.from(originalBytes));
      } finally {
        await removeTestArtifactRoot(outsideRoot);
      }
    });

    it('throws InvalidStorageKeyError reading a symlinked destination, without reading the outside target', async () => {
      const outsideRoot = await createTestArtifactRoot();
      try {
        const outsideTarget = join(outsideRoot, 'secret.png');
        await writeFile(outsideTarget, Uint8Array.from([13, 13, 13]));

        const key = buildArtifactStorageKey({
          runId: newRunId(),
          artifactId: newArtifactId(),
          kind: 'browser_screenshot',
        });
        const destination = join(root, key);
        await mkdir(dirname(destination), { recursive: true });
        await symlink(outsideTarget, destination);

        await expect(storage.get(key)).rejects.toThrow(InvalidStorageKeyError);
      } finally {
        await removeTestArtifactRoot(outsideRoot);
      }
    });

    it('rejects a symlinked intermediate directory before creating anything outside the root', async () => {
      const outsideRoot = await createTestArtifactRoot();
      try {
        const runId = newRunId();
        const key = buildArtifactStorageKey({
          runId,
          artifactId: newArtifactId(),
          kind: 'browser_screenshot',
        });

        // Replace the run's own directory with a symlink to a directory outside
        // the root, before it would otherwise be created.
        const runsDir = join(root, 'runs');
        await mkdir(runsDir, { recursive: true });
        await symlink(outsideRoot, join(runsDir, runId));

        await expect(
          storage.put({ key, bytes: Uint8Array.from([1, 2, 3]), contentType: 'image/png' }),
        ).rejects.toThrow(InvalidStorageKeyError);

        await expect(storage.get(key)).rejects.toThrow(InvalidStorageKeyError);

        // The escape is detected against the deepest already-existing ancestor
        // before any mkdir runs, so nothing is ever created past the symlink —
        // not a file, and not a directory either.
        expect(await readdir(outsideRoot)).toEqual([]);
      } finally {
        await removeTestArtifactRoot(outsideRoot);
      }
    });
  });
});
