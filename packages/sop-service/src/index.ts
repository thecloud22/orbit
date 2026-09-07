/**
 * @orbit/sop-service
 *
 * The composition root for SOP drafting: it generates a graph with
 * @orbit/sop-generation and persists it with @orbit/db, and it is the only
 * package permitted to depend on both.
 *
 * The same arrangement as @orbit/artifacts and @orbit/artifact-service, for the
 * same reason: generation stays testable without a database, persistence stays
 * ignorant of models, and the transaction that joins them lives in one place.
 */
export const PACKAGE_NAME = '@orbit/sop-service' as const;

export * from './candidate-service';
export * from './draft-service';
export * from './publish-recording-service';
export * from './publish-service';
export * from './recording-service';
export * from './revision-service';
