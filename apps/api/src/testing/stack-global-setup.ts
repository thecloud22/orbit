import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createTestArtifactRoot, removeTestArtifactRoot } from '@orbit/artifacts/testing';
import {
  createDatabase,
  runMigrations,
  seedFindServiceRequest,
  createRepositories,
} from '@orbit/db';
import { loadTestEnv, resolveTestDatabaseUrl, truncateOrbitTables } from '@orbit/db/testing';
import { databaseNameFromUrl } from '@orbit/db';
import { brokenExtractLocatorAgentIr } from '@orbit/runtime/testing';

import { E2E_API_PORT, E2E_API_URL, E2E_WATCHTOWER_URL, E2E_WEB_PORT } from './stack-ports';

/**
 * Brings up the Watchtower stack for the end-to-end test.
 *
 * The API it starts is pointed at `orbit_test` and at a disposable artifact root
 * under the OS temp directory — never `DATABASE_URL` and never
 * `data/artifacts`. `process.loadEnvFile` does not override variables that are
 * already set, so the explicit environment handed to the child wins over the
 * repository `.env`.
 *
 * The database is prepared once here rather than truncated between tests: the
 * API is a separate process holding its own pool, and emptying the tables under
 * it mid-suite would delete the Agent Version it is serving.
 */
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const READY_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 250;

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

  const api = start('api', ['--filter', '@orbit/api', 'start'], {
    DATABASE_URL: databaseUrl,
    ARTIFACT_STORAGE_DIR: artifactRoot,
    API_PORT: String(E2E_API_PORT),
    API_HOST: '127.0.0.1',
    LOG_LEVEL: 'warn',
  });

  const web = start('web', ['--filter', '@orbit/web', 'dev', '--port', String(E2E_WEB_PORT)], {
    ORBIT_API_URL: E2E_API_URL,
  });

  try {
    await waitFor(`${E2E_API_URL}/health`, 'the API');
    await waitFor(E2E_WATCHTOWER_URL, 'Watchtower');
  } catch (error) {
    await Promise.all([stopAndWait(api), stopAndWait(web)]);
    await removeTestArtifactRoot(artifactRoot);
    throw error;
  }

  process.stdout.write(`\nWatchtower stack ready: ${E2E_WATCHTOWER_URL} -> ${E2E_API_URL}\n`);

  return async () => {
    // Waited on rather than fired and forgotten: the API may still be finishing
    // a dispatched run, and a later suite that truncates `orbit_test` must not
    // start while a live process is still writing to it.
    await Promise.all([stopAndWait(api), stopAndWait(web)]);
    await removeTestArtifactRoot(artifactRoot);
  };
}

const SHUTDOWN_TIMEOUT_MS = 15_000;

/** Signals the process group, waits for it to exit, then forces the issue. */
async function stopAndWait(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null) {
    return;
  }

  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
  });

  stop(child);

  const timedOut = await Promise.race([
    exited.then(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), SHUTDOWN_TIMEOUT_MS)),
  ]);

  if (timedOut) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
    await exited;
  }
}

function start(name: string, args: readonly string[], env: Record<string, string>): ChildProcess {
  // Detached so the whole process group can be signalled; killing the pnpm
  // wrapper alone would leave the server holding its port.
  const child = spawn('pnpm', [...args], {
    cwd: REPOSITORY_ROOT,
    stdio: 'ignore',
    detached: true,
    env: { ...process.env, ...env },
  });

  child.on('error', (error) => {
    process.stderr.write(`Failed to start ${name}: ${error.message}\n`);
  });

  return child;
}

function stop(child: ChildProcess): void {
  if (child.pid === undefined) {
    return;
  }

  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    // Already gone.
  }
}

async function waitFor(url: string, description: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  for (;;) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_500) });
      if (response.ok) {
        return;
      }
    } catch {
      // Not up yet.
    }

    if (Date.now() > deadline) {
      throw new Error(`${description} did not answer at ${url} within ${READY_TIMEOUT_MS}ms.`);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
