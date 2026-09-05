/**
 * @orbit/runtime
 *
 * The executor-neutral workflow runtime: interprets Agent IR, manages run and
 * step state transitions, resolves restricted interpolation, and emits
 * structured events.
 *
 * Boundary: depends on executor *interfaces* only, never on a concrete
 * executor such as @orbit/executor-playwright. The browser worker composes
 * the runtime with an executor implementation. Playwright must never decide
 * workflow order or business outcomes.
 *
 * Task 1 scaffold: contains no runtime yet. Implemented in Task 6.
 */
export const PACKAGE_NAME = '@orbit/runtime' as const;
