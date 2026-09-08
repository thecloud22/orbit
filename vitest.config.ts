import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Repository maintenance scripts are plain Node ESM, and the pure
    // decision logic behind `pnpm bootstrap` is unit-tested alongside them.
    include: ['{apps,packages}/*/src/**/*.test.ts', 'scripts/**/*.test.mjs'],
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
