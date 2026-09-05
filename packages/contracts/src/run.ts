import { z } from 'zod';

/**
 * Technical run status and business outcome are deliberately separate concepts
 * (ADR-006). A run that correctly determines a record does not exist is
 * `succeeded` with the business outcome `request_not_found`, not a failure.
 */

export const runStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const TERMINAL_RUN_STATUSES = ['succeeded', 'failed', 'cancelled'] as const;

export function isTerminalRunStatus(status: RunStatus): boolean {
  return (TERMINAL_RUN_STATUSES as readonly RunStatus[]).includes(status);
}

/** `none` is the outcome of a run that has not reached a business conclusion. */
export const businessOutcomeSchema = z.enum(['request_found', 'request_not_found', 'none']);
export type BusinessOutcome = z.infer<typeof businessOutcomeSchema>;

/**
 * The outcomes a `complete` step may declare. `none` is excluded: completing a
 * workflow means reaching a business conclusion.
 */
export const terminalBusinessOutcomeSchema = z.enum(['request_found', 'request_not_found']);
export type TerminalBusinessOutcome = z.infer<typeof terminalBusinessOutcomeSchema>;

/**
 * Step status is separate from run status: a step has no business outcome, and
 * a run can succeed with a failed step only if the workflow says so. `pending`
 * exists for a step row created at dispatch time, before execution begins.
 */
export const runStepStatusSchema = z.enum(['pending', 'running', 'succeeded', 'failed']);
export type RunStepStatus = z.infer<typeof runStepStatusSchema>;

export const TERMINAL_RUN_STEP_STATUSES = ['succeeded', 'failed'] as const;

export function isTerminalRunStepStatus(status: RunStepStatus): boolean {
  return (TERMINAL_RUN_STEP_STATUSES as readonly RunStepStatus[]).includes(status);
}

/**
 * Who or what started a run.
 *
 * Phase 1 has no authentication, but the actor is an explicit field rather than
 * an assumption so a real identity can replace the development stub without
 * reshaping persisted run history.
 */
export const triggerActorSchema = z.strictObject({
  type: z.enum(['development_user']),
  id: z.string().min(1),
});
export type TriggerActor = z.infer<typeof triggerActorSchema>;

/**
 * The normalized Run Request. Phase 1 only ever produces `watchtower_manual`,
 * but runs persist the whole envelope so API, webhook, and schedule triggers
 * later become new `type` values rather than a schema migration.
 */
export const runTriggerSchema = z.strictObject({
  type: z.enum(['watchtower_manual']),
  actor: triggerActorSchema,
  source: z.strictObject({ application: z.string().min(1) }).optional(),
});
export type RunTrigger = z.infer<typeof runTriggerSchema>;

/** Phase 1 declares only string-typed inputs and outputs. */
export const runInputsSchema = z.record(z.string().min(1), z.string());
export type RunInputs = z.infer<typeof runInputsSchema>;

export const runOutputsSchema = z.record(z.string().min(1), z.string());
export type RunOutputs = z.infer<typeof runOutputsSchema>;
