import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['{apps,packages}/*/src/**/*.test.ts'],
    // Database integration tests (`pnpm test:db`), real-browser runtime tests
    // (`pnpm test:runtime`), and the Watchtower end-to-end tests
    // (`pnpm test:e2e:watchtower`) live in their own projects, so that
    // `pnpm test` stays runnable with nothing but a checkout.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.db.test.ts',
      '**/*.runtime.test.ts',
      '**/*.e2e.test.ts',
    ],
    passWithNoTests: false,
  },
});
