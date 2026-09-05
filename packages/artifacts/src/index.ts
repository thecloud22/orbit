/**
 * @orbit/artifacts
 *
 * The artifact storage interface and its adapters. Artifact bytes
 * (screenshots, DOM snapshots, Playwright traces) are stored outside
 * PostgreSQL; only metadata and links are persisted in the database.
 *
 * Boundary: the storage interface exists so the Phase 1 local filesystem
 * adapter can later be replaced by object storage without changing runtime
 * or evidence contracts (ADR-010). This package knows nothing about
 * PostgreSQL, Drizzle, or @orbit/db; composing byte storage with metadata
 * persistence is @orbit/artifact-service's job, not this package's.
 */
export const PACKAGE_NAME = '@orbit/artifacts' as const;

export * from './config';
export * from './content-types';
export * from './errors';
export * from './local-filesystem-storage';
export * from './storage';
export * from './storage-key';
