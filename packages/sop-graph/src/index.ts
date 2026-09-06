/**
 * @orbit/sop-graph
 *
 * The SOP Graph: a typed, versioned, **non-executable** description of business
 * and browser intent, plus its validation and reorder rules.
 *
 * Boundary — and this one is the point of the package, not a detail. Nothing
 * here can execute anything. Its entire runtime dependency surface is Zod, so it
 * has no route to Playwright, to the runtime, to a database, to the filesystem,
 * or to the network. It must never reach the Agent IR package either: ADR-002
 * keeps business intent and the executable plan as two independent
 * representations, and a graph becoming an Agent Version is a separate,
 * separately reviewed step in a later sub-phase.
 *
 * A URL in a graph is an untrusted draft reference. It is parsed for shape and
 * never fetched, probed, or resolved.
 */
export const PACKAGE_NAME = '@orbit/sop-graph' as const;

export * from './declarations';
export * from './describe';
export * from './graph';
export * from './parse';
export * from './reorder';
export * from './sop-graph';
export * from './steps';
export * from './validate';
export * from './values';
