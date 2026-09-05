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
