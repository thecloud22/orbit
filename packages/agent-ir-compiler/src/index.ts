/**
 * Compiling a reviewed SOP Graph into candidate Agent IR.
 *
 * Deterministic and pure. No model: translating a reviewed document into a
 * typed workflow is an exact operation, and a model would make an exact answer
 * approximate. No database and no browser: this package computes a candidate
 * and refuses one, and nothing else.
 */
export const PACKAGE_NAME = '@orbit/agent-ir-compiler' as const;

export * from './compile';
export * from './refusals';
export * from './sandbox';
