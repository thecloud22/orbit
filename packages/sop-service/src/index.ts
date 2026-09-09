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

export * from './binding/binding-service';
export * from './drafting/candidate-service';
export * from './recording/demonstration-service';
export * from './drafting/draft-service';
export * from './publishing/publish-bound-document-service';
export * from './publishing/publish-pipeline';
export * from './publishing/publish-recording-service';
export * from './publishing/publish-service';
export * from './recording/recording-service';
export * from './binding/recovery-service';
export * from './revision/revision-service';
export * from './drafting/rule-service';
export * from './drafting/discard-service';
