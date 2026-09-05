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
