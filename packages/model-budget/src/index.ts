/**
 * @orbit/model-budget
 *
 * One definition of a model spend cap, and one estimate of what a call costs.
 *
 * Extracted from @orbit/sop-generation when a second caller appeared. Judged
 * decisions at run time and SOP drafting both have to answer "may this call be
 * made?", and two answers to that question would eventually disagree — the
 * same reason `stepChecksum` has one home. So this package holds the check, the
 * scopes and the rate table, and both callers depend on it.
 *
 * Boundary: it depends on nothing. No Zod, no database, no provider, no clock,
 * no environment. It is a pure function over numbers a caller has already
 * measured, which is what lets it sit under both a package that reaches the
 * network and a runtime that must never be able to.
 */
export const PACKAGE_NAME = '@orbit/model-budget' as const;

export * from './budget';
export * from './rates';
