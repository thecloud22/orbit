/**
 * @orbit/executor-playwright
 *
 * The Playwright implementation of the approved browser action types
 * (navigate, fill, click, assert, expect_one_of, extract) behind the
 * runtime's executor interface.
 *
 * Boundary: implements approved Agent IR steps; it does not control workflow
 * order or determine business outcomes. Playwright code must not leak into
 * @orbit/agent-ir, @orbit/contracts, or @orbit/runtime — this package is the
 * only one in the workspace that depends on it.
 */
export const PACKAGE_NAME = '@orbit/executor-playwright' as const;

export * from './errors';
export * from './locator';
export * from './playwright-executor';
