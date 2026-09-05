import { mkdtemp, readdir, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { StorageRootError } from '../errors';
import {
  createTestArtifactRoot,
  isOwnedTestArtifactRoot,
  removeAllTestArtifactRoots,
  removeTestArtifactRoot,
} from './test-root';

// Roots created directly in a test body, cleaned up afterward regardless of
// whether the test itself already removed them (removeTestArtifactRoot is
// only called here for roots still owned, since removing an unowned path throws).
let createdInTest: string[] = [];

afterEach(async () => {
  for (const root of createdInTest) {
    if (isOwnedTestArtifactRoot(root)) {
      await removeTestArtifactRoot(root);
    }
  }
  createdInTest = [];
});

describe('createTestArtifactRoot', () => {
  it('returns an absolute path under the OS temp directory that exists and is empty', async () => {
    const root = await createTestArtifactRoot();
    createdInTest.push(root);

    expect(isAbsolute(root)).toBe(true);

    const realTmpDir = await realpath(tmpdir());
    expect(root.startsWith(realTmpDir + sep)).toBe(true);

    expect(await stat(root)).toBeDefined();
    expect(await readdir(root)).toEqual([]);
  });

  it('returns different paths across two calls', async () => {
    const first = await createTestArtifactRoot();
    const second = await createTestArtifactRoot();
    createdInTest.push(first, second);

    expect(first).not.toBe(second);
  });
});

describe('removeTestArtifactRoot', () => {
  it('removes a root it created', async () => {
    const root = await createTestArtifactRoot();

    await removeTestArtifactRoot(root);

    await expect(stat(root)).rejects.toThrow();
  });

  it('throws for the OS temp directory itself, and does not remove it', async () => {
    await expect(removeTestArtifactRoot(tmpdir())).rejects.toThrow(StorageRootError);

    // Proves nothing was deleted: the temp directory is still usable.
    await expect(stat(tmpdir())).resolves.toBeDefined();
  });

  it('throws for a directory it did not create, and does not remove it', async () => {
    const manualDir = await mkdtemp(join(tmpdir(), 'orbit-test-root-manual-'));

    try {
      await expect(removeTestArtifactRoot(manualDir)).rejects.toThrow(StorageRootError);
      await expect(stat(manualDir)).resolves.toBeDefined();
    } finally {
      await rm(manualDir, { recursive: true, force: true });
    }
  });
});

describe('isOwnedTestArtifactRoot', () => {
  it('reflects ownership across creation and removal', async () => {
    const root = await createTestArtifactRoot();

    expect(isOwnedTestArtifactRoot(root)).toBe(true);

    await removeTestArtifactRoot(root);

    expect(isOwnedTestArtifactRoot(root)).toBe(false);
  });

  it('is false for a path never created by the helper', () => {
    expect(isOwnedTestArtifactRoot(join(tmpdir(), 'never-created-by-the-helper'))).toBe(false);
  });
});

describe('removeAllTestArtifactRoots', () => {
  it('removes every root created since the last cleanup', async () => {
    const first = await createTestArtifactRoot();
    const second = await createTestArtifactRoot();

    await removeAllTestArtifactRoots();

    expect(isOwnedTestArtifactRoot(first)).toBe(false);
    expect(isOwnedTestArtifactRoot(second)).toBe(false);
    await expect(stat(first)).rejects.toThrow();
    await expect(stat(second)).rejects.toThrow();
  });
});
