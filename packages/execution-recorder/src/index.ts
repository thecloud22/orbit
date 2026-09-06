/**
 * @orbit/execution-recorder
 *
 * The capture engine: a human demonstrates a step once in a real browser, and
 * this turns that demonstration into the selector chain and fingerprint an
 * Execution Binding needs.
 *
 * Boundary. This is the package sub-phase 2.4 was split to isolate. It injects
 * a script into a page, which is a capability ADR-008 denies the runtime
 * outright, so it is kept structurally apart: nothing in @orbit/runtime,
 * @orbit/executor-playwright, or apps/browser-worker may reach it, and the
 * process that executes agents must never be able to load it — not directly and
 * not through a shared dependency.
 *
 * What it is *not*: it has no database, no model, and no knowledge of the SOP
 * Graph. It produces a target; deciding which step that target belongs to and
 * persisting it is the composition root's job.
 */
export const PACKAGE_NAME = '@orbit/execution-recorder' as const;

export * from './derive';
export * from './injected';
export * from './session';
