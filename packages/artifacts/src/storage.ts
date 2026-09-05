import type { ArtifactStorageKey } from './storage-key';

/**
 * The artifact storage boundary (ADR-010).
 *
 * This interface, not the local adapter beneath it, is the durable seam: an
 * S3-compatible implementation must be able to replace the filesystem one
 * without any runtime or evidence contract changing. So nothing here mentions
 * paths, directories, or file handles — only opaque keys and bytes.
 *
 * There is deliberately no `delete`. Nothing in Phase 1 needs to remove an
 * artifact, retention and cleanup workers are out of scope, and omitting it
 * means this interface cannot be used to destroy evidence.
 */
export interface ArtifactStorage {
  /** Human-readable description of where bytes go. For logs; never a secret. */
  readonly rootDescription: string;

  /**
   * Writes bytes under a key that must not already exist.
   *
   * Returns the size and digest of what was actually written, which is what the
   * caller persists as artifact metadata — never values computed from anything
   * other than the stored bytes.
   */
  put(request: PutArtifactRequest): Promise<PutArtifactResult>;

  /** Reads bytes back, with the digest of what was actually read. */
  get(key: ArtifactStorageKey): Promise<GetArtifactResult>;

  exists(key: ArtifactStorageKey): Promise<boolean>;
}

export interface PutArtifactRequest {
  readonly key: ArtifactStorageKey;
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

export interface PutArtifactResult {
  readonly key: ArtifactStorageKey;
  readonly contentType: string;
  readonly sizeBytes: number;
  /** Lowercase hex sha-256 of the bytes written, matching the artifact contract. */
  readonly sha256: string;
}

export interface GetArtifactResult {
  readonly key: ArtifactStorageKey;
  readonly bytes: Uint8Array;
  readonly sizeBytes: number;
  readonly sha256: string;
}
