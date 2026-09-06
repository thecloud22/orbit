/**
 * Test-only helpers for @orbit/sop-generation.
 *
 * Exported as `@orbit/sop-generation/testing` rather than from the package root
 * so production code cannot reach the fake provider, and so the root entry point
 * never pulls a test double into a real process.
 */
export * from './fake-provider';
export * from './proposals';
