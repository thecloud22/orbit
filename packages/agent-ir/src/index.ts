/**
 * @orbit/agent-ir
 *
 * The typed, versioned, serializable executable workflow contract, plus its
 * validation rules and YAML fixture loading.
 *
 * Boundary: depends only on @orbit/contracts. Must never import React,
 * Fastify, Drizzle, or Playwright — Agent IR describes what to execute, not
 * how a particular executor performs it.
 *
 * Task 1 scaffold: contains no IR types yet. Implemented in Task 3.
 */
export const PACKAGE_NAME = '@orbit/agent-ir' as const;
