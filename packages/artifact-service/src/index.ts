/**
 * @orbit/artifact-service
 *
 * Composes artifact byte storage (@orbit/artifacts) with artifact metadata
 * persistence (@orbit/db). Neither of those packages depends on the other, so
 * this one is where the required write ordering lives:
 *
 *   validate -> write bytes -> persist metadata -> persist links
 *
 * Boundary: no Fastify, React, or Playwright. Task 6's runtime is its first
 * caller; this package creates no evidence of its own.
 */
export const PACKAGE_NAME = '@orbit/artifact-service' as const;

export * from './artifact-service';
