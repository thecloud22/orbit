import type { ErrorCode, OrbitError } from '@orbit/contracts';

/**
 * The runtime's failure type.
 *
 * Every failure is classified exactly once, at the point it is raised, and then
 * propagates unchanged: the same `OrbitError` is written to the run step and to
 * the run. Nothing downstream re-classifies, upgrades, or replaces it.
 *
 * The persisted `message` is composed by Orbit, never taken from the underlying
 * library. A Playwright timeout message embeds a "call log" containing page
 * state, and putting that in the database would leak page content into evidence
 * that is meant to be safe structured detail. The original error is kept as
 * `cause` for the worker's logs and is never persisted.
 */
export class RuntimeError extends Error {
  readonly code: ErrorCode;
  readonly details: readonly ErrorDetail[];
  /** The Agent IR step being executed, when the failure belongs to one. */
  readonly agentStepId: string | undefined;

  constructor(input: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly details?: readonly ErrorDetail[];
    readonly agentStepId?: string;
    readonly cause?: unknown;
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = new.target.name;
    this.code = input.code;
    this.details = input.details ?? [];
    this.agentStepId = input.agentStepId;
  }

  /** The safe, structured form persisted on a run step and a run. */
  toOrbitError(): OrbitError {
    return {
      code: this.code,
      message: this.message,
      ...(this.details.length === 0 ? {} : { details: [...this.details] }),
    };
  }
}

export interface ErrorDetail {
  readonly field: string;
  readonly message: string;
}

export function isRuntimeError(error: unknown): error is RuntimeError {
  return error instanceof RuntimeError;
}

/**
 * Wraps anything thrown into a classified runtime error.
 *
 * An already-classified error passes through untouched — re-wrapping would be
 * exactly the masking that the failure policy forbids. Anything else becomes
 * `INTERNAL_ERROR` with an Orbit-authored message, because an unclassified
 * failure is a gap in the runtime, not a diagnosis.
 */
export function asRuntimeError(
  error: unknown,
  context: { readonly agentStepId?: string },
): RuntimeError {
  if (isRuntimeError(error)) {
    return error;
  }

  return new RuntimeError({
    code: 'INTERNAL_ERROR',
    message: 'The runtime failed with an unclassified error.',
    ...(context.agentStepId === undefined ? {} : { agentStepId: context.agentStepId }),
    cause: error,
  });
}

/** The raw message of an underlying failure, for logs only. Never persisted. */
export function describeCause(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === 'string' ? error : undefined;
}
