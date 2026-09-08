/**
 * @orbit/runtime/testing
 *
 * Test-only doubles and fixtures for packages that compose the runtime.
 * Exported as a subpath so production code cannot reach them, and so the
 * package root never pulls in test scaffolding.
 *
 * `browser-global-setup.ts` and `suite-lock-global-setup.ts` are deliberately
 * not re-exported here: they are Vitest `globalSetup` entry points, referenced
 * by path from the configs that need them, and importing one has side effects.
 */
export * from './fakes';
export * from './fake-judge';
export * from './managed-process';
export * from './deadline';
export * from './fixture';
export * from './suite-lock';
