import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { runMigrations } from '@orbit/db';
import { loadTestEnv, resolveTestDatabaseUrl } from '@orbit/db/testing';

/**
 * Global setup for the real-browser integration project.
 *
 * It prepares both things those tests need and neither of the other suites do:
 * the guarded test database schema, and a running demo portal.
 *
 * The portal is reused when one is already listening and started otherwise —
 * the same posture as `apps/demo-portal/playwright.config.ts`, so running these
 * tests alongside `pnpm dev` does not fight it. Only a portal this setup started
 * is stopped again.
 */

const PORTAL_URL = 'http://localhost:3001/requests';
const READY_TIMEOUT_MS = 60_000;
const READY_POLL_INTERVAL_MS = 250;
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

async function isPortalUp(): Promise<boolean> {
  try {
    const response = await fetch(PORTAL_URL, { signal: AbortSignal.timeout(1_500) });
    return response.ok;
  } catch {
    return false;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export default async function setup(): Promise<() => Promise<void>> {
  loadTestEnv();
  const { databaseName } = await runMigrations(resolveTestDatabaseUrl());
  process.stdout.write(`\nRuntime integration schema ready in database "${databaseName}".\n`);

  if (await isPortalUp()) {
    process.stdout.write('Reusing the demo portal already listening on port 3001.\n');
    return async () => undefined;
  }

  // Detached so the whole process group can be signalled: killing the pnpm
  // wrapper alone would leave Vite holding port 3001.
  const portal: ChildProcess = spawn('pnpm', ['--filter', '@orbit/demo-portal', 'dev'], {
    cwd: REPOSITORY_ROOT,
    stdio: 'ignore',
    detached: true,
  });

  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (!(await isPortalUp())) {
    if (Date.now() > deadline) {
      stop(portal);
      throw new Error(
        `The demo portal did not answer at ${PORTAL_URL} within ${READY_TIMEOUT_MS}ms.`,
      );
    }
    await delay(READY_POLL_INTERVAL_MS);
  }

  process.stdout.write('Started the demo portal on port 3001 for this run.\n');

  return async () => {
    stop(portal);
  };
}

function stop(portal: ChildProcess): void {
  if (portal.pid === undefined) {
    return;
  }

  try {
    process.kill(-portal.pid, 'SIGTERM');
  } catch {
    // Already gone; nothing to clean up.
  }
}
