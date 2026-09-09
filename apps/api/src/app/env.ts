import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ARTIFACT_ROOT_ENV_VAR,
  assertUsableArtifactRoot,
  StorageRootError,
} from '@orbit/artifacts';

/**
 * Environment resolution for the API process.
 *
 * Library code never reads the environment; only entry points do. This mirrors
 * `packages/db/src/cli/env.ts` and `apps/browser-worker/src/cli/env.ts`, and an
 * already-exported variable always wins so CI can supply its own.
 */

// Four levels, because this file sits at `apps/api/src/app/`. It was three
// while it lived at `apps/api/src/`, and moving it one directory deeper
// silently redirected every artifact into `apps/data/` -- inside the repository
// and outside the `/data/` ignore rule, which is the exact failure the comment
// below was written to prevent. A path derived from a file's own location is a
// path that breaks when the file moves and nothing fails, so `env.test.ts`
// now asserts this resolves to the repository root.
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

export function loadRootEnv(): void {
  try {
    process.loadEnvFile(resolve(REPOSITORY_ROOT, '.env'));
  } catch {
    // No .env is fine when the variables are already exported.
  }
}

/**
 * Resolves the artifact root against the repository, not the process directory.
 *
 * `ARTIFACT_STORAGE_DIR` is `./data/artifacts` — a path relative to the
 * repository root, which is where `.gitignore` anchors `/data/`. pnpm runs a
 * workspace script with the *package* as the working directory, so resolving
 * against `process.cwd()` would scatter evidence into `apps/api/data/artifacts`:
 * inside the repository and outside the ignore rule. The repository root is
 * derived from this module's own location, never from where the command was
 * invoked.
 *
 * An absolute value is honoured as given. Every safety check `@orbit/artifacts`
 * applies to a root still applies here.
 */
export function resolveRepositoryArtifactRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[ARTIFACT_ROOT_ENV_VAR];

  if (configured === undefined || configured.trim() === '') {
    throw new StorageRootError(
      `${ARTIFACT_ROOT_ENV_VAR} is not set. See README > Artifact storage for the expected value.`,
    );
  }

  const value = configured.trim();
  return assertUsableArtifactRoot(isAbsolute(value) ? value : resolve(REPOSITORY_ROOT, value));
}
