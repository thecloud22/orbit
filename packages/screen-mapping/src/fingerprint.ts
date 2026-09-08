import { z } from 'zod';

import { fieldsInBufferOrder, type Screen } from './screen';

/**
 * What a screen looked like when a human confirmed it was the right one.
 *
 * The terminal counterpart to `ElementFingerprint`, and it exists for the same
 * reason: before a real action the runtime checks that the screen still agrees
 * with what somebody approved, so "the address resolved" and "the address
 * resolved on the screen a person approved" stay different claims (ADR-018).
 *
 * A green screen fingerprints better than a page. Geometry is fixed, field
 * positions are declared by the host rather than computed by a layout engine,
 * and the whole thing is text — so this comparison has no equivalent of a
 * bounding box that legitimately moves.
 */

/** A caption at a known position: the stable part of a screen's identity. */
export const screenAnchorSchema = z.strictObject({
  row: z.number().int().min(0),
  column: z.number().int().min(0),
  text: z.string(),
});
export type ScreenAnchor = z.infer<typeof screenAnchorSchema>;

export const screenFingerprintSchema = z.strictObject({
  /** Geometry is part of identity: a 3278-2 binding is not valid on a -4. */
  rows: z.number().int().positive(),
  columns: z.number().int().positive(),
  /** How many fields the host sent. A restructured screen changes this. */
  fieldCount: z.number().int().min(0),
  /**
   * Which fields were protected, in buffer order, as a string of `p`/`u`.
   *
   * Compact and highly diagnostic: a screen that swaps an input for a caption,
   * or inserts a field, changes this even when the visible text is identical.
   */
  protectionMask: z.string(),
  /**
   * Captions at fixed positions.
   *
   * Only protected text is anchored. Unprotected content is data — a request
   * number, a status — and changes every run by design, so including it would
   * manufacture drift on every execution. This is the same distinction
   * `ComparisonMode` draws for the browser, made structural instead.
   */
  anchors: z.array(screenAnchorSchema),
});
export type ScreenFingerprint = z.infer<typeof screenFingerprintSchema>;

export const SCREEN_MISMATCH_FIELDS = [
  'geometry',
  'fieldCount',
  'protectionMask',
  'anchor',
] as const;
export type ScreenMismatchField = (typeof SCREEN_MISMATCH_FIELDS)[number];

export interface ScreenMismatch {
  readonly field: ScreenMismatchField;
  readonly expected: string;
  readonly observed: string;
}

export type ScreenComparison =
  | { readonly matches: true }
  | { readonly matches: false; readonly mismatches: readonly ScreenMismatch[] };

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Derives a fingerprint from a screen.
 *
 * The same function runs at record time and at run time, so what is compared is
 * produced identically on both sides. Deriving them separately is how a
 * fingerprint quietly stops matching for reasons that have nothing to do with
 * the host — the parity ADR-018 requires of the browser recorder, kept here by
 * construction rather than by a test.
 */
export function fingerprintOf(screen: Screen): ScreenFingerprint {
  const ordered = fieldsInBufferOrder(screen);

  return {
    rows: screen.rows,
    columns: screen.columns,
    fieldCount: ordered.length,
    protectionMask: ordered.map((field) => (field.attributes.protected ? 'p' : 'u')).join(''),
    anchors: ordered
      .filter((field) => field.attributes.protected && normalize(field.text) !== '')
      .map((field) => ({
        row: field.start.row,
        column: field.start.column,
        text: normalize(field.text),
      })),
  };
}

/**
 * Compares an approved fingerprint against what the host is showing now.
 *
 * Deterministic and total: no model, no heuristics, no partial credit. Every
 * mismatch is reported rather than the first, because a person diagnosing a
 * stopped run needs to see whether one caption was reworded or the screen was
 * rebuilt.
 */
export function compareScreen(
  expected: ScreenFingerprint,
  observed: ScreenFingerprint,
): ScreenComparison {
  const mismatches: ScreenMismatch[] = [];

  if (expected.rows !== observed.rows || expected.columns !== observed.columns) {
    mismatches.push({
      field: 'geometry',
      expected: `${expected.rows}x${expected.columns}`,
      observed: `${observed.rows}x${observed.columns}`,
    });

    // Geometry decides what every position means, so nothing below is
    // comparable once it differs. Reporting a hundred anchor mismatches caused
    // by a terminal model change would bury the one fact that explains them.
    return { matches: false, mismatches };
  }

  if (expected.fieldCount !== observed.fieldCount) {
    mismatches.push({
      field: 'fieldCount',
      expected: String(expected.fieldCount),
      observed: String(observed.fieldCount),
    });
  }

  if (expected.protectionMask !== observed.protectionMask) {
    mismatches.push({
      field: 'protectionMask',
      expected: expected.protectionMask,
      observed: observed.protectionMask,
    });
  }

  const seen = new Map(
    observed.anchors.map((anchor) => [`${anchor.row}:${anchor.column}`, anchor.text]),
  );

  for (const anchor of expected.anchors) {
    const key = `${anchor.row}:${anchor.column}`;
    const found = seen.get(key);

    if (found !== anchor.text) {
      mismatches.push({
        field: 'anchor',
        expected: `${key} "${anchor.text}"`,
        observed: found === undefined ? `${key} absent` : `${key} "${found}"`,
      });
    }
  }

  return mismatches.length === 0 ? { matches: true } : { matches: false, mismatches };
}
