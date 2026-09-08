/**
 * @orbit/sop-generation
 *
 * Turning free-form SOP text into a proposed SOP Graph: the model boundary, the
 * prompt, and the generate-validate-repair pipeline.
 *
 * Boundary. This package generates and validates; it never persists. It does not
 * depend on @orbit/db, on the API, or on the web application — composing
 * generation with persistence is @orbit/sop-service's job, exactly as composing
 * artifact bytes with metadata is @orbit/artifact-service's.
 *
 * It legitimately reaches the network, but only in one direction and only from
 * the two provider modules — `anthropic-provider.ts` and `bedrock-provider.ts`,
 * one of which a deployment selects through `createSopProvider`. Nothing
 * here ever fetches, navigates, probes, or resolves a URL that appears *inside*
 * a graph. Those remain untrusted draft references, exactly as they were in
 * sub-phase 2.1 (ADR-016), all the way through generation and persistence.
 *
 * The deterministic fake provider lives behind the `./testing` subpath so that
 * production code cannot reach it.
 */
export const PACKAGE_NAME = '@orbit/sop-generation' as const;

export * from './anthropic-provider';
export * from './bedrock-provider';
export * from './budget';
export * from './generate';
export * from './prompt';
export * from './proposal';
export * from './provider';
export * from './provider-factory';
export * from './structured-response';
