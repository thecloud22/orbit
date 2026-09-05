import { isAbsolute, resolve, sep } from 'node:path';

import { StorageRootError } from './errors';

/**
 * Artifact root resolution.
 *
 * `ARTIFACT_STORAGE_DIR` is the only setting, with no default: a missing value
 * is an error rather than a silent fallback that would scatter evidence
 * somewhere nobody looks.
 */
export const ARTIFACT_ROOT_ENV_VAR = 'ARTIFACT_STORAGE_DIR';

/**
 * Path segments an artifact root must not contain.
 *
 * `public` and `dist` are where a dev server or build output is served from;
 * writing evidence there would publish it over HTTP, which ADR-010's
 * "access-controlled" requirement rules out. `node_modules` is never a place
 * application data belongs.
 */
const FORBIDDEN_ROOT_SEGMENTS = new Set(['public', 'dist', 'node_modules']);

/**
 * Resolves the configured root to an absolute path.
 *
 * Resolution happens once, when the adapter is constructed. The result is never
 * re-derived from caller input, so no request can influence where the root is.
 */
export function resolveArtifactRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[ARTIFACT_ROOT_ENV_VAR];

  if (configured === undefined || configured.trim() === '') {
    throw new StorageRootError(
      `${ARTIFACT_ROOT_ENV_VAR} is not set. See README > Artifact storage for the expected value.`,
    );
  }

  return assertUsableArtifactRoot(resolve(configured.trim()));
}

/** Rejects roots that are unusable or that would expose evidence. */
export function assertUsableArtifactRoot(root: string): string {
  if (!isAbsolute(root)) {
    throw new StorageRootError(`Artifact root must be an absolute path, got "${root}".`);
  }

  const segments = root.split(sep).filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    throw new StorageRootError('Artifact root must not be the filesystem root.');
  }

  for (const segment of segments) {
    if (FORBIDDEN_ROOT_SEGMENTS.has(segment)) {
      throw new StorageRootError(
        `Artifact root must not contain a "${segment}" path segment: artifact bytes must not be servable or live inside build output. Got "${root}".`,
      );
    }
  }

  return root;
}
