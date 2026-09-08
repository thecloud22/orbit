import { defineConfig } from 'vitest/config';

/**
 * Real-browser runtime integration tests.
 *
 * A third project, separate from `pnpm test` and `pnpm test:db`, because these
 * need three things neither of those requires: an installed Chromium, a running
 * demo portal, and TEST_DATABASE_URL. Keeping them apart is what lets
 * `pnpm test` stay runnable with nothing but a checkout, and `pnpm test:db`
 * stay runnable without a browser.
 *
 * `fileParallelism` is disabled for the same reason as the database project:
 * these files share one database and truncate between tests.
 *
 * The suite lock is the first global setup, ahead of anything that starts a
 * server or touches a table, so a collision with another suite costs nothing.
 * See `packages/runtime/src/testing/suite-lock.ts`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['{apps,packages}/*/src/**/*.runtime.test.ts'],
    globalSetup: [
      'packages/runtime/src/testing/suite-lock-global-setup.ts',
      'packages/runtime/src/testing/browser-global-setup.ts',
    ],
    reporters: [
      'default',
      // A failure is never only in a scrollback buffer that a `tail` can
      // truncate away. See README > Validation commands.
      ['json', { outputFile: 'logs/test-runtime.json' }],
    ],
    fileParallelism: false,
    passWithNoTests: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
