import { newRequestId, type ErrorCode, type ErrorDetail, type OrbitError } from '@orbit/contracts';

/**
 * The API's typed failures.
 *
 * Every response body that is not a success is this envelope, and every one of
 * them carries a code from the Phase 1 taxonomy. Nothing here ever includes a
 * filesystem path, a storage key, a stack trace, or a database message: an error
 * body is read by a browser and must be as safe as any other payload.
 *
 * Note a real gap: the Phase 1 error taxonomy has no `NOT_FOUND` code, so a 404
 * is reported as `VALIDATION_ERROR` with a message naming what was not found.
 * Widening `@orbit/contracts` is out of scope for this task; see the Task 7-8
 * report's open questions.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: readonly ErrorDetail[];

  constructor(input: {
    readonly code: ErrorCode;
    readonly statusCode: number;
    readonly message: string;
    readonly details?: readonly ErrorDetail[];
    readonly cause?: unknown;
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = new.target.name;
    this.code = input.code;
    this.statusCode = input.statusCode;
    this.details = input.details ?? [];
  }
}

export interface ErrorEnvelope {
  readonly error: OrbitError;
}

export function badRequest(message: string, details?: readonly ErrorDetail[]): ApiError {
  return new ApiError({
    code: 'VALIDATION_ERROR',
    statusCode: 400,
    message,
    ...(details === undefined ? {} : { details }),
  });
}

export function invalidInput(message: string, details?: readonly ErrorDetail[]): ApiError {
  return new ApiError({
    code: 'INPUT_ERROR',
    statusCode: 400,
    message,
    ...(details === undefined ? {} : { details }),
  });
}

/**
 * A 404.
 *
 * Deliberately the same shape for "does not exist" and "exists but is not linked
 * to this run": distinguishing them would let a caller probe which artifact ids
 * are real.
 */
export function notFound(message: string): ApiError {
  return new ApiError({ code: 'VALIDATION_ERROR', statusCode: 404, message });
}

export function internalError(message: string, cause?: unknown): ApiError {
  return new ApiError({ code: 'INTERNAL_ERROR', statusCode: 500, message, cause });
}

export function artifactStorageError(message: string, cause?: unknown): ApiError {
  return new ApiError({ code: 'ARTIFACT_STORAGE_ERROR', statusCode: 500, message, cause });
}

export function toErrorEnvelope(error: ApiError): ErrorEnvelope {
  return {
    error: {
      code: error.code,
      message: error.message,
      requestId: newRequestId(),
      ...(error.details.length === 0 ? {} : { details: [...error.details] }),
    },
  };
}
