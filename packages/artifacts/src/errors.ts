import { type ErrorCode, type OrbitError } from '@orbit/contracts';

/**
 * Typed artifact storage failures.
 *
 * Every one of these exists so that a containment, integrity, or I/O problem
 * fails loudly at the point it is detected. Nothing in this package returns a
 * plausible-looking value when the filesystem disagrees with what the caller
 * asked for, and no error is swallowed to keep a write "succeeding".
 *
 * All of them classify as `ARTIFACT_STORAGE_ERROR` in the Phase 1 taxonomy
 * (docs/contracts/events-and-evidence.md); `toOrbitError` performs that mapping
 * so callers never hand a raw exception to an event payload.
 */
export class ArtifactStorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }

  /** Every artifact storage failure is one technical error code. */
  get code(): ErrorCode {
    return 'ARTIFACT_STORAGE_ERROR';
  }
}

/** A storage key failed the grammar, or resolved outside the configured root. */
export class InvalidStorageKeyError extends ArtifactStorageError {}

/** The configured artifact root is missing, unusable, or unsafe to write into. */
export class StorageRootError extends ArtifactStorageError {}

/**
 * The destination is already occupied.
 *
 * Completed artifact bytes are never overwritten, so a collision is a failure
 * rather than a silent replacement.
 */
export class ArtifactAlreadyExistsError extends ArtifactStorageError {}

/** No artifact exists for the given key or id. */
export class ArtifactNotFoundError extends ArtifactStorageError {}

export class ArtifactWriteError extends ArtifactStorageError {}

export class ArtifactReadError extends ArtifactStorageError {}

/** Stored bytes no longer match the digest recorded when they were written. */
export class ArtifactIntegrityError extends ArtifactStorageError {}

/**
 * Converts a storage failure into the structured error envelope.
 *
 * Messages here describe keys, roots, and digests — never artifact bytes, so a
 * failure cannot leak page content into an event payload or a log line.
 */
export function toOrbitError(error: ArtifactStorageError): OrbitError {
  return { code: error.code, message: error.message };
}

export function isArtifactStorageError(error: unknown): error is ArtifactStorageError {
  return error instanceof ArtifactStorageError;
}

/** The POSIX error code a failed filesystem call reported, when there is one. */
export function filesystemErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error as { code: unknown };
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}
