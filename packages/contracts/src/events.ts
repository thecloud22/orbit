import { z } from 'zod';

import {
  agentVersionIdSchema,
  artifactIdSchema,
  eventIdSchema,
  runIdSchema,
  runStepIdSchema,
} from './ids';

/**
 * The Phase 1 structured event types.
 *
 * Logical `step.*` events are the authoritative record of progress; the
 * `browser.*` completion events supplement them with action detail and never
 * replace them.
 */
export const eventTypeSchema = z.enum([
  'run.queued',
  'run.started',
  'run.completed',
  'run.failed',

  'step.started',
  'step.completed',
  'step.failed',

  'browser.navigation.completed',
  'browser.fill.completed',
  'browser.click.completed',
  'browser.extract.completed',

  'assertion.passed',
  'assertion.failed',

  /**
   * A judged decision, from the question asked to the branch taken (ADR-032).
   *
   * Three events rather than one, and `requested` is appended *before* the
   * provider is called. A call that never returns still leaves a record that it
   * was made, and the alternatives it was offered are on the request rather than
   * on the answer, so what the model was allowed to say is evidence in its own
   * right.
   */
  'decision.requested',
  'decision.resolved',
  'decision.refused',

  'artifact.created',
]);
export type EventType = z.infer<typeof eventTypeSchema>;

/**
 * The event envelope.
 *
 * `sequence` is the ordering authority within a run; timestamps alone must not
 * be relied upon. `runStepId` and `agentStepId` are absent for run-scoped
 * lifecycle events, which belong to no single step.
 */
export const eventEnvelopeSchema = z.strictObject({
  id: eventIdSchema,
  schemaVersion: z.string().min(1),
  runId: runIdSchema,
  runStepId: runStepIdSchema.optional(),
  agentVersionId: agentVersionIdSchema,
  agentStepId: z.string().min(1).optional(),
  eventType: eventTypeSchema,
  occurredAt: z.iso.datetime(),
  sequence: z.number().int().nonnegative(),
  /** Safe structured detail. Never secrets, credentials, or raw page content. */
  payload: z.record(z.string(), z.unknown()),
  artifactRefs: z.array(artifactIdSchema),
});
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
