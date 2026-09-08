/**
 * @orbit/runtime/testing
 *
 * Test-only doubles and fixtures for packages that compose the runtime.
 * Exported as a subpath so production code cannot reach them, and so the
 * package root never pulls in test scaffolding.
 *
 * `browser-global-setup.ts` is deliberately not re-exported here: it pulls in
 * Vitest through @orbit/db/testing and is referenced directly by
 * vitest.runtime.config.ts.
 */
export * from './fakes';
export * from './fake-judge';
export * from './managed-process';
export * from './fixture';
