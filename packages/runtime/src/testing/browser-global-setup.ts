import { fileURLToPath } from 'node:url';

import { runMigrations } from '@orbit/db';
import { loadTestEnv, resolveTestDatabaseUrl } from '@orbit/db/testing';

import {
  adoptedProcess,
  isHttpReady,
  startManagedProcess,
  waitForHttpReady,
  waitForPortReleased,
  type ManagedProcess,
} from './managed-process';

/**
 * Global setup for the real-browser integration project.
 *
 * It prepares the two things those tests need and the other suites do not: the
 * guarded test database schema, and a running demo portal.
 *
 * The portal is reused when one is already listening and started otherwise —
 * the same posture as `apps/demo-portal/playwright.config.ts`, so running these
 * tests alongside `pnpm dev` does not fight it. Only a portal this run started
 * is stopped again, and stopping it waits for the process to actually exit.
 */
export const DEMO_PORTAL_URL = 'http://localhost:3001/requests';
export const DEMO_PORTAL_PORT = 3001;

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

export default async function setup(): Promise<() => Promise<void>> {
  loadTestEnv();
  const { databaseName } = await runMigrations(resolveTestDatabaseUrl());
  process.stdout.write(`\nRuntime integration schema ready in database "${databaseName}".\n`);

  let portal: ManagedProcess;
  let started = false;

  if (await isHttpReady(DEMO_PORTAL_URL)) {
    process.stdout.write('Reusing the demo portal already listening on port 3001.\n');
    portal = adoptedProcess('demo-portal');
  } else {
    portal = startManagedProcess({
      name: 'demo-portal',
      command: 'pnpm',
      args: ['--filter', '@orbit/demo-portal', 'dev'],
      cwd: REPOSITORY_ROOT,
    });

    try {
      await waitForHttpReady(DEMO_PORTAL_URL, 'The demo portal');
    } catch (error) {
      await portal.stop();
      throw error;
    }

    started = true;
    process.stdout.write('Started the demo portal on port 3001 for this run.\n');
  }

  return async () => {
    await portal.stop();

    // Only for a portal this run owns: an adopted one is expected to keep
    // listening, and waiting for its port to close would hang.
    if (started) {
      await waitForPortReleased(DEMO_PORTAL_PORT, 'The demo portal');
    }
  };
}
