/**
 * What a green screen is, how a step names a field on one, and how a screen is
 * compared against what somebody approved.
 *
 * Pure by construction: Zod is the only runtime dependency. There is no
 * transport here and no I/O of any kind — the model is populated by whatever
 * drives the terminal, which is why the choice of transport could change without
 * touching this package (ADR-037, TASK-P3-000).
 */
export const PACKAGE_NAME = '@orbit/screen-mapping' as const;

export * from './screen';
export * from './addressing';
export * from './fingerprint';
