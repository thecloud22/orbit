import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

import { StorageRootError } from '../errors';

/**
 * Disposable artifact roots for tests.
 *
 * These helpers delete directories, so they are guarded the way the Task 4
 * database reset is guarded: a test must not be able to remove a developer's
 * `data/artifacts` — or anything else — by passing the wrong path.
 *
 * Two independent conditions must hold before anything is removed:
 *
 * 1. The path was created by `createTestArtifactRoot` in this process, tracked
 *    below. A path this module did not create is never removed, however it looks.
 * 2. The resolved path is inside the operating system temp directory, so even a
 *    corrupted ledger cannot reach the repository or a developer's data.
 *
 * Removal uses `fs.rm`, never a shell command.
 */

const TEST_ROOT_PREFIX = 'orbit-artifacts-test-';

/** Roots this process created. Membership is required before removal. */
const ownedRoots = new Set<string>();

/** Creates an empty, uniquely named artifact root under the OS temp directory. */
export async function createTestArtifactRoot(): Promise<string> {
  const base = await realpath(tmpdir());
  const created = await mkdtemp(join(base, TEST_ROOT_PREFIX));
  const root = await realpath(created);

  ownedRoots.add(root);
  return root;
}

/**
 * Removes a root this module created.
 *
 * Refuses anything else, rather than silently doing nothing, so a test that
 * points cleanup at the wrong directory fails loudly instead of appearing to
 * pass while leaving state behind.
 */
export async function removeTestArtifactRoot(root: string): Promise<void> {
  const resolved = resolve(root);

  if (!ownedRoots.has(resolved)) {
    throw new StorageRootError(
      `Refusing to remove "${resolved}": it was not created by createTestArtifactRoot().`,
    );
  }

  const temporaryBase = await realpath(tmpdir());

  if (!resolved.startsWith(temporaryBase + sep)) {
    throw new StorageRootError(
      `Refusing to remove "${resolved}": it is outside the operating system temp directory.`,
    );
  }

  await rm(resolved, { recursive: true, force: true });
  ownedRoots.delete(resolved);
}

/** Removes every root this process created. For a suite-level teardown. */
export async function removeAllTestArtifactRoots(): Promise<void> {
  for (const root of [...ownedRoots]) {
    await removeTestArtifactRoot(root);
  }
}

/** Whether a path is a root this module created. Exported for the guard's own tests. */
export function isOwnedTestArtifactRoot(root: string): boolean {
  return ownedRoots.has(resolve(root));
}
