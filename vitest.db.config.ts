import { defineConfig } from 'vitest/config';

/**
 * Database integration tests.
 *
 * These are a separate project from `pnpm test` because they require a running
 * PostgreSQL server and TEST_DATABASE_URL, and because they truncate every
 * Orbit table between tests. Unit tests must stay runnable by anyone with a
 * checkout and nothing else.
 *
 * `fileParallelism` is disabled: the files share one database, and the reset
 * between tests would otherwise race across workers.
 *
 * The same reasoning extends across *projects*, which is what the suite lock
 * enforces: this project truncates `orbit_test`, and so do the runtime and
 * end-to-end projects, so only one of the three may run at a time.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['{apps,packages}/*/src/**/*.db.test.ts'],
    globalSetup: [
      'packages/runtime/src/testing/suite-lock-global-setup.ts',
      'packages/db/src/testing/global-setup.ts',
    ],
    fileParallelism: false,
    passWithNoTests: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
