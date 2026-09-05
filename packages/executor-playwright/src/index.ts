/**
 * @orbit/executor-playwright
 *
 * The Playwright implementation of the approved browser action types
 * (navigate, fill, click, assert, expect_one_of, extract) behind the
 * runtime's executor interface.
 *
 * Boundary: implements approved Agent IR steps; it does not control workflow
 * order or determine business outcomes. Playwright code must not leak into
 * @orbit/agent-ir or @orbit/contracts.
 *
 * Task 1 scaffold: Playwright is intentionally not installed yet. The
 * dependency and the executor arrive in Task 6.
 */
export const PACKAGE_NAME = '@orbit/executor-playwright' as const;
