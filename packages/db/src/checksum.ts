import { createHash } from 'node:crypto';

import type { SopStep } from '@orbit/sop-graph';

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

/**
 * The checksum an Execution Binding records for the step it binds to.
 *
 * A binding is keyed by `(document, step)` rather than by revision, so an edit
 * elsewhere in the graph leaves it alone (ADR-018). This is what makes that
 * safe: when *this* step's content changes, the hash stops matching and the
 * binding is known stale, deterministically and with nothing inferred.
 *
 * It lives here, next to `sha256Of`, rather than in whichever tool happens to
 * write a binding first. Two components must agree on it — the recorder that
 * stores it and the compiler that later trusts it — and a rule written down in
 * an ADR for each of them to reimplement is not agreement, it is a coincidence
 * waiting to end. There is one function, and both import it.
 */
export function stepChecksum(step: SopStep): string {
  return sha256Of(step);
}
