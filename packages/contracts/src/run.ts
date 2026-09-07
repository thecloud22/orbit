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

/**
 * A business outcome is a declared identifier, not a fixed vocabulary (ADR-030).
 *
 * It is the name the workflow's own outcome step already carries — `borrowed`,
 * `held`, `escalated` — so there is nothing to map it onto and nothing to
 * mistranslate. Phase 1's `request_found` / `request_not_found` remain valid
 * because they satisfy this grammar like any other name, which is why widening
 * the contract needed no migration of a single existing run.
 *
 * Bounded at 64 characters so a name that reaches this schema is one a person
 * would actually write, and so the Zod schema and the database CHECK constraint
 * can state the same rule.
 */
export const BUSINESS_OUTCOME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * The one reserved name: a run that has not reached a business conclusion.
 *
 * Reserved rather than merely conventional, because it is the column default.
 * A workflow that could declare an outcome called `none` would make "no
 * conclusion yet" and "the conclusion is none" the same stored value.
 */
export const NO_BUSINESS_OUTCOME = 'none';

/** `none` is the outcome of a run that has not reached a business conclusion. */
export const businessOutcomeSchema = z
  .string()
  .regex(
    BUSINESS_OUTCOME_PATTERN,
    'A business outcome must start with a lowercase letter and use only lowercase letters, digits and underscores.',
  );
export type BusinessOutcome = z.infer<typeof businessOutcomeSchema>;

/**
 * The outcomes a `complete` step may declare. `none` is excluded: completing a
 * workflow means reaching a business conclusion.
 */
export const terminalBusinessOutcomeSchema = businessOutcomeSchema.refine(
  (outcome) => outcome !== NO_BUSINESS_OUTCOME,
  { message: `"${NO_BUSINESS_OUTCOME}" is reserved for a run with no business conclusion yet.` },
);
export type TerminalBusinessOutcome = z.infer<typeof terminalBusinessOutcomeSchema>;

/** Whether a name may be declared as a workflow's business outcome. */
export function isDeclarableBusinessOutcome(name: string): boolean {
  return terminalBusinessOutcomeSchema.safeParse(name).success;
}

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
