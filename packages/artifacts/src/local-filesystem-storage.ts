import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';

import { generateUlid } from '@orbit/contracts';

import { assertUsableArtifactRoot } from './config';
import {
  ArtifactAlreadyExistsError,
  ArtifactNotFoundError,
  ArtifactReadError,
  ArtifactWriteError,
  InvalidStorageKeyError,
  StorageRootError,
  filesystemErrorCode,
} from './errors';
import type {
  ArtifactStorage,
  GetArtifactResult,
  PutArtifactRequest,
  PutArtifactResult,
} from './storage';
import { parseArtifactStorageKey, type ArtifactStorageKey } from './storage-key';

/**
 * Local filesystem artifact storage.
 *
 * ## Containment
 *
 * Three independent checks stand between a key and the filesystem, because any
 * one of them alone has a gap:
 *
 * 1. The key grammar, which cannot express `..`, an absolute path, or a
 *    backslash in the first place.
 * 2. A lexical check that the joined path is still under the root — this
 *    catches a key that somehow bypassed validation.
 * 3. A `realpath` of the destination's parent directory immediately before the
 *    I/O call, which is the only check that catches a **symlink** planted in an
 *    intermediate directory. Lexical checks cannot see symlinks.
 *
 * ## Atomicity
 *
 * A write goes to a temporary file in the destination's own directory, is
 * fsynced, and is then published with `link()`. `link()` is used rather than
 * `rename()` because `rename()` silently replaces an existing file, and
 * completed evidence must never be overwritten; `link()` fails with `EEXIST`
 * instead. A reader therefore never observes a partially written artifact.
 *
 * What this does **not** guarantee: the parent directory is not fsynced, so a
 * power loss immediately after publication can still lose the directory entry;
 * and hard links require the temporary file to share a filesystem with its
 * destination, which holds here only because it is written in the same
 * directory. A crash mid-write leaves an inert `.part` file, which nothing
 * removes automatically — cleanup workers are out of Phase 1 scope.
 */

/** Marks a transient file. Cannot collide with a key: the grammar forbids a leading dot. */
const TEMPORARY_PREFIX = '.orbit-tmp-';
const TEMPORARY_SUFFIX = '.part';

/** Artifacts are readable only by the owner; evidence is not world-readable. */
const ARTIFACT_FILE_MODE = 0o600;

/**
 * `O_NOFOLLOW` makes the kernel refuse to open a symlinked final component.
 * It is POSIX-only; where it is unavailable the `lstat` check below is the
 * portable fallback, which narrows but does not fully close the race.
 */
const O_NOFOLLOW = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;

export interface LocalFilesystemArtifactStorageOptions {
  /** Absolute path to the artifact root; resolved and realpathed once here. */
  readonly root: string;
}

function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Asserts a resolved path is the root itself or lives beneath it.
 *
 * Compared with `sep` appended so that a sibling directory sharing a prefix —
 * `/data/artifacts-evil` against a root of `/data/artifacts` — is not mistaken
 * for a child.
 */
function assertWithinRoot(root: string, candidate: string, key: string): void {
  const resolved = resolve(candidate);

  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw new InvalidStorageKeyError(
      `Artifact storage key "${key}" resolves outside the artifact root.`,
    );
  }
}

/**
 * Finds the deepest directory on this path that already exists.
 *
 * Used to check containment *before* creating anything: `mkdir` with
 * `recursive: true` will happily create directories through a symlink that
 * escapes the root, so the escape has to be detected before the first mkdir,
 * not after it.
 */
async function deepestExistingAncestor(target: string): Promise<string> {
  let current = target;

  for (;;) {
    try {
      await lstat(current);
      return current;
    } catch {
      const parent = dirname(current);

      // Reached the filesystem root without finding anything that exists.
      if (parent === current) {
        return current;
      }

      current = parent;
    }
  }
}

export async function createLocalFilesystemArtifactStorage(
  options: LocalFilesystemArtifactStorageOptions,
): Promise<ArtifactStorage> {
  const requested = assertUsableArtifactRoot(resolve(options.root));

  try {
    await mkdir(requested, { recursive: true });
  } catch (error) {
    throw new StorageRootError(`Could not create artifact root "${requested}".`, { cause: error });
  }

  // Resolved once. Every later containment check compares against this value,
  // so a symlink swapped in afterwards is detected rather than followed.
  let root: string;
  try {
    root = await realpath(requested);
  } catch (error) {
    throw new StorageRootError(`Could not resolve artifact root "${requested}".`, { cause: error });
  }

  /**
   * Resolves a key to its absolute destination, re-validating the key and
   * confirming containment. `requireParent` distinguishes a read (the directory
   * must already exist) from a write (it is created first).
   */
  async function resolveDestination(
    key: ArtifactStorageKey,
    options: { readonly createParent: boolean },
  ): Promise<{ destination: string; parent: string }> {
    // Re-validated even though the type says it is a key: a value can reach
    // here through a cast, and this is the last point before filesystem I/O.
    const validated = parseArtifactStorageKey(key);
    const destination = join(root, validated);
    assertWithinRoot(root, destination, validated);

    const parent = dirname(destination);

    if (options.createParent) {
      // Containment is checked against what already exists before any directory
      // is created, so a symlinked intermediate cannot be traversed by mkdir.
      const existingAncestor = await deepestExistingAncestor(parent);

      let realAncestor: string;
      try {
        realAncestor = await realpath(existingAncestor);
      } catch (error) {
        throw new ArtifactWriteError(`Could not resolve the directory for key "${validated}".`, {
          cause: error,
        });
      }

      assertWithinRoot(root, realAncestor, validated);

      try {
        await mkdir(parent, { recursive: true });
      } catch (error) {
        throw new ArtifactWriteError(`Could not create the directory for key "${validated}".`, {
          cause: error,
        });
      }
    }

    // The symlink check. A lexical comparison cannot detect that
    // `runs/<id>/steps` is a symlink to somewhere else entirely; resolving the
    // parent and re-checking containment is what does.
    let realParent: string;
    try {
      realParent = await realpath(parent);
    } catch (error) {
      if (filesystemErrorCode(error) === 'ENOENT') {
        throw new ArtifactNotFoundError(`No artifact is stored under key "${validated}".`, {
          cause: error,
        });
      }
      throw new ArtifactReadError(`Could not resolve the directory for key "${validated}".`, {
        cause: error,
      });
    }

    assertWithinRoot(root, realParent, validated);

    // Rebuilt from the resolved parent, so the path actually used for I/O is
    // the one that was containment-checked, not the unresolved one.
    return { destination: join(realParent, basename(destination)), parent: realParent };
  }

  async function assertDestinationVacant(destination: string, key: string): Promise<void> {
    try {
      await lstat(destination);
    } catch (error) {
      if (filesystemErrorCode(error) === 'ENOENT') {
        return;
      }
      throw new ArtifactWriteError(`Could not inspect the destination for key "${key}".`, {
        cause: error,
      });
    }

    // Reached only when lstat succeeded, so something already occupies the path
    // — a file, a directory, or a symlink. None of them may be replaced.
    throw new ArtifactAlreadyExistsError(
      `An artifact already exists at key "${key}". Completed artifact bytes are never overwritten.`,
    );
  }

  return {
    rootDescription: root,

    async put(request: PutArtifactRequest): Promise<PutArtifactResult> {
      const { destination, parent } = await resolveDestination(request.key, {
        createParent: true,
      });

      // Fails fast with a clear error. The real guarantee is the exclusive
      // link() below, which closes the race this check cannot.
      await assertDestinationVacant(destination, request.key);

      const temporaryPath = join(parent, `${TEMPORARY_PREFIX}${generateUlid()}${TEMPORARY_SUFFIX}`);

      // Reaching past this block means link() succeeded: every other path throws.
      try {
        // 'wx' is O_WRONLY|O_CREAT|O_EXCL: it refuses to follow or clobber an
        // existing file, including a symlink planted at this path.
        const handle = await open(temporaryPath, 'wx', ARTIFACT_FILE_MODE);

        try {
          await handle.writeFile(request.bytes);
          await handle.sync();
        } finally {
          await handle.close();
        }

        try {
          await link(temporaryPath, destination);
        } catch (error) {
          if (filesystemErrorCode(error) === 'EEXIST') {
            throw new ArtifactAlreadyExistsError(
              `An artifact already exists at key "${request.key}". Completed artifact bytes are never overwritten.`,
            );
          }
          throw error;
        }
      } catch (error) {
        if (error instanceof ArtifactAlreadyExistsError) {
          throw error;
        }
        throw new ArtifactWriteError(`Could not write the artifact for key "${request.key}".`, {
          cause: error,
        });
      } finally {
        // Best effort, and deliberately silent: a failure to remove the
        // temporary file must never replace the real error, and an orphaned
        // `.part` file is inert.
        await unlink(temporaryPath).catch(() => undefined);
      }

      return {
        key: request.key,
        contentType: request.contentType,
        sizeBytes: request.bytes.byteLength,
        sha256: sha256Of(request.bytes),
      };
    },

    async get(key: ArtifactStorageKey): Promise<GetArtifactResult> {
      const { destination } = await resolveDestination(key, { createParent: false });

      // Rejects a symlinked final component even where O_NOFOLLOW is
      // unavailable, and turns a missing file into the typed not-found error.
      let stats;
      try {
        stats = await lstat(destination);
      } catch (error) {
        if (filesystemErrorCode(error) === 'ENOENT') {
          throw new ArtifactNotFoundError(`No artifact is stored under key "${key}".`, {
            cause: error,
          });
        }
        throw new ArtifactReadError(`Could not inspect the artifact for key "${key}".`, {
          cause: error,
        });
      }

      if (stats.isSymbolicLink()) {
        throw new InvalidStorageKeyError(
          `The path for key "${key}" is a symbolic link; artifact reads never follow links.`,
        );
      }

      if (!stats.isFile()) {
        throw new ArtifactReadError(`The path for key "${key}" is not a regular file.`);
      }

      let bytes: Buffer;
      try {
        const handle = await open(destination, fsConstants.O_RDONLY | O_NOFOLLOW);
        try {
          bytes = await handle.readFile();
        } finally {
          await handle.close();
        }
      } catch (error) {
        if (filesystemErrorCode(error) === 'ELOOP') {
          throw new InvalidStorageKeyError(
            `The path for key "${key}" is a symbolic link; artifact reads never follow links.`,
          );
        }
        throw new ArtifactReadError(`Could not read the artifact for key "${key}".`, {
          cause: error,
        });
      }

      return {
        key,
        bytes,
        sizeBytes: bytes.byteLength,
        // Always the digest of what was actually read, never a value carried
        // along from the write.
        sha256: sha256Of(bytes),
      };
    },

    async exists(key: ArtifactStorageKey): Promise<boolean> {
      let destination: string;

      try {
        ({ destination } = await resolveDestination(key, { createParent: false }));
      } catch (error) {
        if (error instanceof ArtifactNotFoundError) {
          return false;
        }
        throw error;
      }

      try {
        const stats = await lstat(destination);
        // A symlink is not a stored artifact, whatever it points at.
        return stats.isFile();
      } catch (error) {
        if (filesystemErrorCode(error) === 'ENOENT') {
          return false;
        }
        throw new ArtifactReadError(`Could not inspect the artifact for key "${key}".`, {
          cause: error,
        });
      }
    },
  };
}
