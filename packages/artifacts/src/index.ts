/**
 * @orbit/artifacts
 *
 * The artifact storage interface and its adapters. Artifact bytes
 * (screenshots, DOM snapshots, Playwright traces) are stored outside
 * PostgreSQL; only metadata and links are persisted in the database.
 *
 * Boundary: the storage interface exists so the Phase 1 local filesystem
 * adapter can later be replaced by object storage without changing runtime
 * or evidence contracts.
 *
 * Task 1 scaffold: contains no storage implementation yet. Implemented in Task 5.
 */
export const PACKAGE_NAME = '@orbit/artifacts' as const;
