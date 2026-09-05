/**
 * @orbit/db
 *
 * Drizzle schema, migrations, and repositories for agents, agent versions,
 * runs, run steps, run events, and artifact metadata.
 *
 * Boundary: the only package permitted to talk to PostgreSQL. Applications
 * depend on its repositories rather than issuing queries themselves, and the
 * web application never depends on it at all. Nothing here imports Fastify,
 * React, Playwright, or any Orbit application package.
 *
 * Binary artifact bytes are never stored in PostgreSQL: this package persists
 * artifact metadata and links, and @orbit/artifacts owns the bytes.
 */
export const PACKAGE_NAME = '@orbit/db' as const;

export * from './checksum';
export * from './client';
export * from './config';
export * from './errors';
export * from './mappers';
export * from './migrate';
export * from './repositories';
export * from './schema';
export * from './seed';
