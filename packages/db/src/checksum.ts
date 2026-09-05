import { createHash } from 'node:crypto';

/**
 * Canonical JSON: object keys sorted at every depth.
 *
 * Two documents that differ only in key order are the same Agent IR, and must
 * produce the same checksum — otherwise re-seeding an unchanged fixture would
 * look like tampering.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (typeof value === 'object' && value !== null) {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};

    for (const key of Object.keys(source).sort()) {
      sorted[key] = canonicalize(source[key]);
    }

    return sorted;
  }

  return value;
}

/** Lowercase hex sha-256 of a document's canonical JSON. */
export function sha256Of(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}
