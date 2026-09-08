/**
 * @orbit/sop-recording
 *
 * Turning a recorded interaction into a SOP Graph and its Execution Bindings.
 *
 * Boundary: pure. Zod, the graph contract, and the binding contract — no
 * browser, no database, no model. Capturing is @orbit/execution-recorder's job
 * and persisting is @orbit/sop-service's; this is only the translation between
 * them, which is why a fixed sequence can be checked against an exact expected
 * graph with nothing running.
 */
export const PACKAGE_NAME = '@orbit/sop-recording' as const;

export * from './align';
export * from './normalize';
export * from './translate';
