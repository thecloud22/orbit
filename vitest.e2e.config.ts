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
 *
 * That separation used to be a convention this comment asked people to keep. It
 * is now enforced: the suite lock below is claimed before anything else starts,
 * and a second suite that shares `orbit_test` is refused by name rather than
 * left to corrupt this one. See `packages/runtime/src/testing/suite-lock.ts`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['{apps,packages}/*/src/**/*.e2e.test.ts'],
    globalSetup: [
      // Claimed first and released last: nothing has been started or truncated
      // when a collision is refused.
      'packages/runtime/src/testing/suite-lock-global-setup.ts',
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
    reporters: [
      'default',
      // A failure is never only in a scrollback buffer that a `tail` can
      // truncate away. See README > Validation commands.
      ['json', { outputFile: 'logs/test-e2e-watchtower.json' }],
    ],
  },
});
