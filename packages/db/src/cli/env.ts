import { fileURLToPath } from 'node:url';

/**
 * Loads the repository-root `.env` for command-line use only.
 *
 * Library code never reads the environment: a repository takes a connection,
 * not an ambient variable. Only these CLI entrypoints and the test harness do,
 * and an already-set variable always wins so CI can supply its own.
 */
export function loadRootEnv(): void {
  const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));

  try {
    process.loadEnvFile(envPath);
  } catch {
    // No .env is fine when the variables are already exported.
  }
}
