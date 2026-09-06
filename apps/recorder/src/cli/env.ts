import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Environment resolution for the recorder process.
 *
 * Library code never reads the environment; only entry points do. Mirrors
 * `apps/browser-worker/src/cli/env.ts`, and an already-exported variable always
 * wins so CI can supply its own.
 */
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

export function loadRootEnv(): void {
  try {
    process.loadEnvFile(resolve(REPOSITORY_ROOT, '.env'));
  } catch {
    // No .env is fine when the variables are already exported.
  }
}
