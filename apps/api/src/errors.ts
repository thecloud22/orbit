import { newRequestId, type ErrorCode, type ErrorDetail, type OrbitError } from '@orbit/contracts';

/**
 * The API's typed failures.
 *
 * Every response body that is not a success is this envelope, and every one of
 * them carries a code from the Phase 1 taxonomy. Nothing here ever includes a
 * filesystem path, a storage key, a stack trace, or a database message: an error
 * body is read by a browser and must be as safe as any other payload.
 *
 * `conflict()` still reports `VALIDATION_ERROR` on a 409 -- the taxonomy has
 * no dedicated `CONFLICT` code, and the status line already carries that
 * distinction. `notFound()` no longer needs the same workaround: `NOT_FOUND`
 * was added once a caller was found branching on the error body rather than
 * the status code, which the old `VALIDATION_ERROR`-for-everything shape
 * could not support.
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
  return new ApiError({ code: 'NOT_FOUND', statusCode: 404, message });
}

/**
 * Naming an id or key that already exists.
 *
 * `VALIDATION_ERROR` for the same reason `notFound` uses it rather than a
 * dedicated code: the Phase 1 taxonomy has no `CONFLICT` entry, and this is
 * the same precedent applied to a second missing case.
 */
export function conflict(message: string): ApiError {
  return new ApiError({ code: 'VALIDATION_ERROR', statusCode: 409, message });
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
