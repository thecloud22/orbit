import { z } from 'zod';

import { requestIdSchema } from './ids';

/**
 * The Phase 1 typed error taxonomy.
 *
 * Business outcomes such as `request_not_found` are never represented here:
 * they are valid conclusions, not technical failures.
 */
export const errorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'INPUT_ERROR',
  'BROWSER_TIMEOUT',
  'LOCATOR_NOT_FOUND',
  'ASSERTION_FAILED',
  'NAVIGATION_FAILED',
  'UNEXPECTED_UI_STATE',

  /**
   * Judged-decision failures (ADR-032).
   *
   * Five codes rather than one, because they are five different things to be
   * told. Someone reading a halted run has to be able to tell "the model was
   * not sure" from "the model could not answer" from "we ran out of budget" —
   * they lead to different fixes, and collapsing them into one code would make
   * the evidence trail agree with itself while telling nobody anything.
   */
  /** No judge is wired into this runtime, so a judged step cannot run at all. */
  'DECISION_JUDGE_UNAVAILABLE',
  /** The provider errored or timed out. The model could not answer. */
  'DECISION_JUDGE_FAILED',
  /** An answer that is not one of the step's own declared alternatives. */
  'DECISION_OUT_OF_SET',
  /** An answer below the threshold in force. The model was not sure enough. */
  'DECISION_LOW_CONFIDENCE',
  /** A spend cap was reached, so no call was made. */
  'DECISION_BUDGET_EXHAUSTED',

  /**
   * Terminal-surface failures. Named separately from their browser equivalents
   * rather than shared: `BROWSER_TIMEOUT` and `LOCATOR_NOT_FOUND` are embedded in
   * published immutable Agent Versions and keep their names forever, so a second
   * surface gets its own codes rather than a rename (ADR-037).
   */
  'API_REQUEST_FAILED',
  'API_RESPONSE_UNEXPECTED',
  'TERMINAL_TIMEOUT',
  'TERMINAL_CONNECT_FAILED',
  'FIELD_NOT_FOUND',
  'UNEXPECTED_SCREEN',
  'WORKER_FAILURE',
  'ARTIFACT_STORAGE_ERROR',
  'INTERNAL_ERROR',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorDetailSchema = z.strictObject({
  field: z.string().min(1),
  message: z.string().min(1),
});
export type ErrorDetail = z.infer<typeof errorDetailSchema>;

/** Safe, structured error data. Must never carry secrets or raw page content. */
export const orbitErrorSchema = z.strictObject({
  code: errorCodeSchema,
  message: z.string().min(1),
  requestId: requestIdSchema.optional(),
  details: z.array(errorDetailSchema).optional(),
});
export type OrbitError = z.infer<typeof orbitErrorSchema>;
