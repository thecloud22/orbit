/**
 * @orbit/contracts
 *
 * Shared domain contracts: opaque IDs, run status and business outcome,
 * structured events, artifact metadata, and the typed error taxonomy.
 *
 * Boundary: depends on nothing but Zod. Must never import React, Fastify,
 * Drizzle, Playwright, or the filesystem.
 */
export const PACKAGE_NAME = '@orbit/contracts' as const;

export * from './artifacts';
export * from './errors';
export * from './events';
export * from './generate-id';
export * from './ids';
export * from './run';
