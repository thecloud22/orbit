import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['{apps,packages}/*/src/**/*.test.ts'],
    // Database integration tests (vitest.db.config.ts, `pnpm test:db`) and
    // real-browser runtime tests (vitest.runtime.config.ts, `pnpm test:runtime`)
    // live in their own projects, so that `pnpm test` stays runnable with
    // nothing but a checkout.
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.db.test.ts', '**/*.runtime.test.ts'],
    passWithNoTests: false,
  },
});
