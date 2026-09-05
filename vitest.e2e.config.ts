import { defineConfig } from 'vitest/config';

/**
 * The Watchtower end-to-end project.
 *
 * Separate from `pnpm test:runtime` for a concrete reason, not for tidiness: the
 * API here is a long-lived process serving `orbit_test`, and the Task 6 runtime
 * tests truncate that database between their own tests. Running both in one
 * project would pull the seeded Agent Version out from under a live server
 * mid-suite. Two projects, two commands, no shared mutable state.
 *
 * Its setup prepares the database once, up front, rather than between tests, for
 * the same reason.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['{apps,packages}/*/src/**/*.e2e.test.ts'],
    globalSetup: [
      // The demo portal the agent automates, plus the test database schema.
      'packages/runtime/src/testing/browser-global-setup.ts',
      // The Watchtower stack: an API pointed at orbit_test and a disposable
      // artifact root, and the web app proxying to it.
      'apps/api/src/testing/stack-global-setup.ts',
    ],
    fileParallelism: false,
    passWithNoTests: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
