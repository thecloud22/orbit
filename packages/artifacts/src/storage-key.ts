import type { ArtifactId, ArtifactKind, RunId, RunStepId } from '@orbit/contracts';
import { z } from 'zod';

import { ARTIFACT_KIND_EXTENSIONS } from './content-types';
import { InvalidStorageKeyError } from './errors';

/**
 * The artifact storage key grammar.
 *
 * A key is an application-generated, opaque, relative identifier — never a
 * filename supplied from outside Orbit, and never a filesystem path. One
 * restrictive grammar replaces a pile of individual defenses: absolute paths,
 * `..` traversal, backslashes, Unicode, whitespace, and control characters are
 * all unrepresentable, so each is rejected by the same rule rather than by a
 * special case that could be forgotten.
 *
 * Keys are validated as given and never normalized to make them pass. A key
 * that needs rewriting to become safe is rejected instead.
 */

export const MAX_KEY_LENGTH = 512;
export const MAX_SEGMENT_LENGTH = 128;
export const MAX_SEGMENTS = 8;

/** Interior segments carry no extension; only the final segment may have one. */
const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const FINAL_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?:\.[a-z0-9]{1,16})?$/;

/**
 * Returns why a value is not a valid storage key, or undefined if it is one.
 *
 * Separated from the schema so the adapter can re-check a key immediately
 * before touching the filesystem without paying for a Zod parse.
 */
export function storageKeyViolation(value: string): string | undefined {
  if (value.length === 0) {
    return 'must not be empty';
  }

  if (value.length > MAX_KEY_LENGTH) {
    return `must be at most ${MAX_KEY_LENGTH} characters, got ${value.length}`;
  }

  // Checked explicitly rather than left to the segment pattern, because a
  // backslash is the one rejection a reader is most likely to expect to be
  // silently translated on Windows. It never is, on any platform.
  if (value.includes('\\')) {
    return 'must not contain a backslash; keys always use "/" separators on every platform';
  }

  const segments = value.split('/');

  if (segments.length > MAX_SEGMENTS) {
    return `must have at most ${MAX_SEGMENTS} segments, got ${segments.length}`;
  }

  for (const [index, segment] of segments.entries()) {
    const isFinal = index === segments.length - 1;
    const pattern = isFinal ? FINAL_SEGMENT_PATTERN : SEGMENT_PATTERN;

    if (segment.length === 0) {
      return 'must not contain an empty segment, a leading "/", or a trailing "/"';
    }

    if (segment === '.' || segment === '..') {
      return `must not contain a "${segment}" segment`;
    }

    if (segment.length > MAX_SEGMENT_LENGTH) {
      return `segment "${segment.slice(0, 16)}…" exceeds ${MAX_SEGMENT_LENGTH} characters`;
    }

    if (!pattern.test(segment)) {
      return `segment "${segment}" must match ${pattern.source}`;
    }
  }

  return undefined;
}

export const artifactStorageKeySchema = z
  .string()
  .superRefine((value, ctx) => {
    const violation = storageKeyViolation(value);

    if (violation !== undefined) {
      ctx.addIssue({ code: 'custom', message: `storage key ${violation}` });
    }
  })
  .brand<'ArtifactStorageKey'>();

export type ArtifactStorageKey = z.infer<typeof artifactStorageKeySchema>;

/** Validates a key, raising the typed storage error rather than a Zod error. */
export function parseArtifactStorageKey(value: string): ArtifactStorageKey {
  const violation = storageKeyViolation(value);

  if (violation !== undefined) {
    throw new InvalidStorageKeyError(`Invalid artifact storage key: ${violation}.`);
  }

  return value as ArtifactStorageKey;
}

export function isArtifactStorageKey(value: string): value is ArtifactStorageKey {
  return storageKeyViolation(value) === undefined;
}

export interface BuildArtifactStorageKeyInput {
  readonly runId: RunId;
  readonly artifactId: ArtifactId;
  readonly kind: ArtifactKind;
  readonly runStepId?: RunStepId;
}

/**
 * The only producer of storage keys.
 *
 * The filename is the artifact's own opaque id, so a key is unique by
 * construction — which is also what satisfies the database's global
 * `storage_key` uniqueness constraint without any coordination between writers.
 * The extension comes from the artifact kind; no caller-supplied filename ever
 * reaches the filesystem.
 */
export function buildArtifactStorageKey(input: BuildArtifactStorageKeyInput): ArtifactStorageKey {
  const extension = ARTIFACT_KIND_EXTENSIONS[input.kind];

  const key =
    input.runStepId === undefined
      ? `runs/${input.runId}/${input.artifactId}.${extension}`
      : `runs/${input.runId}/steps/${input.runStepId}/${input.artifactId}.${extension}`;

  // Opaque ids are generated, not supplied, so a violation here is a bug in
  // Orbit rather than bad input — but it is still checked, because a key that
  // reaches the filesystem unvalidated is exactly the failure this grammar exists to prevent.
  return parseArtifactStorageKey(key);
}
