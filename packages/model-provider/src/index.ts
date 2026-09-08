/**
 * @orbit/model-provider
 *
 * One place that decides which model family a deployment uses, how it is
 * reached, and with what credentials — and one place that constructs the
 * client. Three packages call a model (drafting, judged decisions, authoring
 * advice); all three route through here, so `LLM_PROVIDER` moves all of them or
 * none of them.
 *
 * Boundary. This package holds a model client and nothing else: no database, no
 * browser, no filesystem, no Orbit domain type beyond `ModelCallUsage`. It does
 * not know what a SOP, a run or a step is, and the domain contracts stay in the
 * packages that own them — this supplies a bound schema and a reply, and the
 * caller decides what that reply means.
 *
 * @orbit/runtime cannot reach this package, by construction and by test:
 * `packages/runtime/src/decision-judge-boundary.test.ts` walks the workspace
 * closure and names it forbidden (ADR-032, ADR-034).
 */
export const PACKAGE_NAME = '@orbit/model-provider' as const;

export * from './chat-model';
export * from './deprecation';
export * from './selection';
export * from './usage';
