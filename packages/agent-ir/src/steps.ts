import { errorCodeSchema, terminalBusinessOutcomeSchema } from '@orbit/contracts';
import { z } from 'zod';

import { assertionSchema } from './assertions';
import { identifierSchema } from './declarations';
import { locatorSchema } from './locator';

/** Agent IR step identifiers are workflow-local names, not persisted entity IDs. */
export const stepIdSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);

/** A source SOP step reference; validated against the agent's declared registry. */
export const sopStepIdSchema = z.string().min(1);

export const evidenceSchema = z.strictObject({
  captureScreenshot: z.boolean().optional(),
  captureDomSnapshot: z.boolean().optional(),
});
export type Evidence = z.infer<typeof evidenceSchema>;

const timeoutMsSchema = z.number().int().positive();

/**
 * Every executable step carries at least one source SOP step ID. This is what
 * makes Watchtower's expected-versus-observed view possible, and it is required
 * rather than optional so traceability cannot quietly be dropped.
 */
const stepBase = {
  id: stepIdSchema,
  sourceSopStepIds: z.array(sopStepIdSchema).min(1),
};

export const extractFieldSchema = z.strictObject({
  locator: locatorSchema,
  method: z.enum(['text']),
});
export type ExtractField = z.infer<typeof extractFieldSchema>;

export const expectOneOfAlternativeSchema = z.strictObject({
  whenVisible: locatorSchema,
  next: stepIdSchema,
});
export type ExpectOneOfAlternative = z.infer<typeof expectOneOfAlternativeSchema>;

export const browserNavigateStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal('browser.navigate'),
  url: z.string().min(1),
  timeoutMs: timeoutMsSchema.optional(),
  evidence: evidenceSchema.optional(),
  assertions: z.array(assertionSchema).optional(),
});

export const browserFillStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal('browser.fill'),
  locator: locatorSchema,
  value: z.string().min(1),
  timeoutMs: timeoutMsSchema.optional(),
  evidence: evidenceSchema.optional(),
});

export const browserClickStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal('browser.click'),
  locator: locatorSchema,
  timeoutMs: timeoutMsSchema.optional(),
  evidence: evidenceSchema.optional(),
});

export const browserAssertStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal('browser.assert'),
  assertion: assertionSchema,
  timeoutMs: timeoutMsSchema.optional(),
  evidence: evidenceSchema.optional(),
});

/**
 * Resolves which of several known UI states occurred, and branches explicitly.
 *
 * At least two alternatives are required: a single alternative is not a choice
 * and is better expressed as a `browser.assert` with `locator_visible`.
 */
export const browserExpectOneOfStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal('browser.expect_one_of'),
  alternatives: z.array(expectOneOfAlternativeSchema).min(2),
  timeoutMs: timeoutMsSchema.optional(),
  evidence: evidenceSchema.optional(),
});

export const browserExtractStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal('browser.extract'),
  fields: z
    .record(identifierSchema, extractFieldSchema)
    .refine((fields) => Object.keys(fields).length > 0, 'must declare at least one field'),
  /** Maps a declared variable to a `${result.<field>}` reference of this step. */
  assign: z
    .record(identifierSchema, z.string().min(1))
    .refine((assign) => Object.keys(assign).length > 0, 'must assign at least one variable'),
  timeoutMs: timeoutMsSchema.optional(),
  evidence: evidenceSchema.optional(),
});

export const completeStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal('complete'),
  outcome: terminalBusinessOutcomeSchema,
  outputs: z.record(identifierSchema, z.string().min(1)).optional(),
});

export const failStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal('fail'),
  errorCode: errorCodeSchema,
  message: z.string().min(1),
});

export const agentIrStepSchema = z.discriminatedUnion('type', [
  browserNavigateStepSchema,
  browserFillStepSchema,
  browserClickStepSchema,
  browserAssertStepSchema,
  browserExpectOneOfStepSchema,
  browserExtractStepSchema,
  completeStepSchema,
  failStepSchema,
]);
export type AgentIrStep = z.infer<typeof agentIrStepSchema>;
export type AgentIrStepType = AgentIrStep['type'];

export const TERMINAL_STEP_TYPES = ['complete', 'fail'] as const;

export function isTerminalStep(step: AgentIrStep): boolean {
  return (TERMINAL_STEP_TYPES as readonly string[]).includes(step.type);
}
