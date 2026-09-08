/**
 * @orbit/runtime
 *
 * The executor-neutral workflow runtime: interprets Agent IR, manages run and
 * step state transitions, resolves restricted interpolation, and emits
 * structured events.
 *
 * Boundary: depends on executor *interfaces* only, never on a concrete
 * executor such as @orbit/executor-playwright, and never on Playwright,
 * Drizzle, or a database driver. The PostgreSQL-backed implementation of the
 * persistence port lives behind the `@orbit/runtime/persistence` subpath, so
 * this entry point stays free of it.
 */
export const PACKAGE_NAME = '@orbit/runtime' as const;

export * from './decision';
export * from './errors';
export * from './drift';
export * from './evidence';
export * from './interpolate';
export * from './interpreter';
export * from './inputs';
export * from './logger';
export * from './ports';
export * from './recovery';
export * from './redact';
export * from './prepare';
export * from './profile';
