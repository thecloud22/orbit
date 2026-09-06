/**
 * @orbit/execution-mapping
 *
 * The Execution Binding: what one SOP step actually does on a real page.
 *
 * Boundary. This package is pure — Zod and the closed `Locator` vocabulary from
 * @orbit/agent-ir, nothing else. It has no browser, no database, no network, and
 * no model. It describes a binding and compares a fingerprint; recording one is
 * a separate tool, and acting on one is the runtime's job.
 *
 * It deliberately does not import @orbit/sop-graph. A binding is executable
 * detail and a graph is business intent, and ADR-002 keeps those two
 * representations independent; validating a binding against a step therefore
 * takes a small description of that step from the caller rather than reaching
 * into the graph package for it.
 */
export const PACKAGE_NAME = '@orbit/execution-mapping' as const;

export * from './binding';
export * from './fingerprint';
export * from './lifecycle';
export * from './selectors';
export * from './validate';
