import { fileURLToPath } from 'node:url';

import { createTestArtifactRoot, removeTestArtifactRoot } from '@orbit/artifacts/testing';
import {
  createDatabase,
  createRepositories,
  databaseNameFromUrl,
  runMigrations,
  seedFindServiceRequest,
} from '@orbit/db';
import { loadTestEnv, resolveTestDatabaseUrl, truncateOrbitTables } from '@orbit/db/testing';
import {
  brokenExtractLocatorAgentIr,
  startManagedProcess,
  waitForHttpReady,
  waitForPortReleased,
} from '@orbit/runtime/testing';

import { E2E_API_PORT, E2E_API_URL, E2E_WATCHTOWER_URL, E2E_WEB_PORT } from './stack-ports';

/**
 * Brings up the Watchtower stack for the end-to-end test.
 *
 * The API it starts is pointed at `orbit_test` and at a disposable artifact root
 * under the OS temp directory — never `DATABASE_URL`, never `data/artifacts`.
 * `process.loadEnvFile` does not override variables that are already set, so the
 * explicit environment handed to the child wins over the repository `.env`.
 *
 * The database is prepared once here rather than truncated between tests: the
 * API is a separate process holding its own pool, and emptying the tables under
 * it mid-suite would delete the Agent Version it is serving.
 */
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

export default async function setup(): Promise<() => Promise<void>> {
  loadTestEnv();

  const databaseUrl = resolveTestDatabaseUrl();
  await runMigrations(databaseUrl);

  const handle = createDatabase({ url: databaseUrl, maxConnections: 2 });

  try {
    // Guarded by the same live `current_database()` check every destructive
    // Orbit test operation uses.
    await truncateOrbitTables(handle.db, databaseNameFromUrl(databaseUrl));
    await seedFindServiceRequest(handle.db);

    // The controlled failure the UI test drives: a published version whose
    // extraction locator names a test id the portal does not render. The demo
    // portal is untouched — the agent is the broken half of the pair.
    const brokenIr = brokenExtractLocatorAgentIr();
    const repositories = createRepositories(handle.db);
    await repositories.agents.upsert({ id: brokenIr.id, name: brokenIr.name });
    await repositories.agentVersions.create({ agentIr: brokenIr });
  } finally {
    await handle.close();
  }

  const artifactRoot = await createTestArtifactRoot();

  const api = startManagedProcess({
    name: 'api',
    command: 'pnpm',
    args: ['--filter', '@orbit/api', 'start'],
    cwd: REPOSITORY_ROOT,
    env: {
      DATABASE_URL: databaseUrl,
      ARTIFACT_STORAGE_DIR: artifactRoot,
      API_PORT: String(E2E_API_PORT),
      API_HOST: '127.0.0.1',
      LOG_LEVEL: 'warn',
    },
  });

  const web = startManagedProcess({
    name: 'watchtower',
    command: 'pnpm',
    args: ['--filter', '@orbit/web', 'dev', '--port', String(E2E_WEB_PORT)],
    cwd: REPOSITORY_ROOT,
    env: { ORBIT_API_URL: E2E_API_URL },
  });

  const stopAll = async (): Promise<void> => {
    // Waited on rather than fired and forgotten: the API may still be finishing
    // a dispatched run, and a later suite that truncates `orbit_test` must not
    // start while a live process is still writing to it.
    await Promise.all([api.stop(), web.stop()]);

    // The processes this run started are `pnpm` wrappers; their servers are
    // grandchildren. Teardown is finished only once the ports are free.
    await Promise.all([
      waitForPortReleased(E2E_API_PORT, 'The API'),
      waitForPortReleased(E2E_WEB_PORT, 'Watchtower'),
    ]);

    await removeTestArtifactRoot(artifactRoot);
  };

  try {
    await waitForHttpReady(`${E2E_API_URL}/health`, 'The API');
    await waitForHttpReady(E2E_WATCHTOWER_URL, 'Watchtower');
  } catch (error) {
    await stopAll();
    throw error;
  }

  process.stdout.write(`\nWatchtower stack ready: ${E2E_WATCHTOWER_URL} -> ${E2E_API_URL}\n`);

  return stopAll;
}
