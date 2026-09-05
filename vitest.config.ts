import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['{apps,packages}/*/src/**/*.test.ts'],
    // Database integration tests need a live PostgreSQL server and live in
    // their own project (vitest.db.config.ts, `pnpm test:db`), so that
    // `pnpm test` stays runnable with nothing but a checkout.
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.db.test.ts'],
    passWithNoTests: false,
  },
});
