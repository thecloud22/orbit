/**
 * @orbit/drift-recovery
 *
 * The implementation behind @orbit/runtime's `RecoveryProposer` port: diagnose
 * a drifted step from its own selector chain, and write a proposal a person
 * will read.
 *
 * Boundary. This package exists so that the runtime does not have to. It has no
 * browser and no model: `diagnoseDrift` is synchronous, so it cannot call one
 * even by accident. It depends on @orbit/execution-assist for candidate
 * narrowing, which is where a ranker would attach if ranking is ever switched
 * on; nothing here calls a model today, and `boundary.test.ts` pins that.
 *
 * It does reach PostgreSQL, from `store.ts` alone, to insert one row into one
 * table. `diagnose.ts` and `proposer.ts` do not, which is what keeps the
 * reasoning testable with no database at all.
 *
 * The one thing this package cannot do, by construction, is apply a proposal.
 * It reaches no Agent Version, no publish path and no browser (ADR-033).
 */
export const PACKAGE_NAME = '@orbit/drift-recovery' as const;

export * from './diagnose';
export * from './proposer';
export * from './store';
