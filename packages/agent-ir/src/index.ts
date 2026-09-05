/**
 * @orbit/agent-ir
 *
 * The typed, versioned executable workflow contract: schemas, inferred types,
 * the control-flow model, and validation.
 *
 * Boundary: depends only on @orbit/contracts, Zod, and a pure YAML parser.
 * Must never import React, Fastify, Drizzle, Playwright, or the filesystem.
 * Agent IR describes what to execute; it knows nothing about how a particular
 * executor performs it.
 */
export const PACKAGE_NAME = '@orbit/agent-ir' as const;

export * from './agent-ir';
export * from './assertions';
export * from './declarations';
export * from './graph';
export * from './interpolation';
export * from './locator';
export * from './parse';
export * from './permissions';
export * from './steps';
export * from './validate';
