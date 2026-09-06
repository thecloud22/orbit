import { z } from 'zod';

/**
 * What an element looked like when a human confirmed it was the right one.
 *
 * A fingerprint is not a selector. The selector says how to find an element;
 * the fingerprint says what was found, so that before a real action the runtime
 * can check the page still agrees. It is the difference between "this locator
 * resolved" and "this locator resolved to the thing a person actually approved".
 *
 * Everything here is readable through a first-class Playwright API. There is no
 * `tagName`, and that omission is deliberate: reading it requires `evaluate`,
 * and keeping script injection out of the executor is worth more than one extra
 * field (ADR-018).
 */

export const boundingBoxSchema = z.strictObject({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type BoundingBox = z.infer<typeof boundingBoxSchema>;

export const elementFingerprintSchema = z.strictObject({
  /** The computed ARIA role, e.g. `button`. Implicit roles included. */
  role: z.string().min(1).nullable(),
  /** The accessible name, e.g. the visible label of a button. */
  accessibleName: z.string().nullable(),
  /** Trimmed visible text. Compared only for action targets — see below. */
  text: z.string().nullable(),
  /** Recorded for diagnosis; never blocks. Layout legitimately moves. */
  boundingBox: boundingBoxSchema.nullable(),
});
export type ElementFingerprint = z.infer<typeof elementFingerprintSchema>;

/**
 * How strictly a fingerprint is compared, which depends on what the step does.
 *
 * `action` targets a control — a button, a field. Its text is its label and is
 * stable, so a change to it is real drift.
 *
 * `read` targets a value the workflow extracts. Its text is the value itself
 * and changes on every run by design: `In Progress` one run, `Closed` the next.
 * Comparing it would manufacture drift on every extract step, so a read
 * fingerprint compares identity — role and accessible name — and never content.
 */
export const comparisonModeSchema = z.enum(['action', 'read']);
export type ComparisonMode = z.infer<typeof comparisonModeSchema>;

export const FINGERPRINT_MISMATCH_FIELDS = ['role', 'accessibleName', 'text'] as const;
export type FingerprintMismatchField = (typeof FINGERPRINT_MISMATCH_FIELDS)[number];

export interface FingerprintMismatch {
  readonly field: FingerprintMismatchField;
  readonly expected: string | null;
  readonly observed: string | null;
}

export type FingerprintComparison =
  | { readonly matches: true }
  | { readonly matches: false; readonly mismatches: readonly FingerprintMismatch[] };

/**
 * Whitespace is normalised before comparing.
 *
 * A page that reflows text across two lines is not a page that changed. Raw
 * `innerText` differs on such a reflow while nothing a reviewer approved has
 * moved, so collapsing runs of whitespace removes a whole class of false drift.
 */
function normalize(value: string | null): string | null {
  return value === null ? null : value.replace(/\s+/g, ' ').trim();
}

/**
 * Compares what was approved against what the page shows now.
 *
 * Deterministic and total: no model call, no heuristics, no partial credit. A
 * field the recording never captured (`null`) is not compared, because absence
 * at record time is not evidence of anything at run time.
 */
export function compareFingerprint(
  expected: ElementFingerprint,
  observed: ElementFingerprint,
  mode: ComparisonMode,
): FingerprintComparison {
  const mismatches: FingerprintMismatch[] = [];

  function check(field: FingerprintMismatchField, left: string | null, right: string | null): void {
    const a = normalize(left);
    const b = normalize(right);

    if (a === null) {
      return;
    }

    if (a !== b) {
      mismatches.push({ field, expected: a, observed: b });
    }
  }

  check('role', expected.role, observed.role);
  check('accessibleName', expected.accessibleName, observed.accessibleName);

  if (mode === 'action') {
    check('text', expected.text, observed.text);
  }

  return mismatches.length === 0 ? { matches: true } : { matches: false, mismatches };
}

/**
 * Turns one line of a Playwright aria snapshot into a role and accessible name.
 *
 * `locator.ariaSnapshot()` yields YAML whose first line describes the target
 * element itself and whose remaining lines describe its subtree, so only the
 * first line is ever read. The forms that occur:
 *
 *   - button "Search"                 role + accessible name
 *   - heading "Service request" [level=2]
 *   - definition: In Progress         role + text content, no name
 *   - status:                         role alone
 *
 * The text after a colon is content, not a name, and is deliberately not read
 * as one — for a read target that content is the extracted value and varies
 * every run.
 */
export function parseAriaSnapshotHeader(snapshot: string): {
  readonly role: string | null;
  readonly accessibleName: string | null;
} {
  const firstLine = snapshot.split('\n', 1)[0]?.trim() ?? '';
  const withoutBullet = firstLine.startsWith('- ') ? firstLine.slice(2) : firstLine;

  const roleMatch = /^([a-zA-Z][a-zA-Z0-9-]*)/.exec(withoutBullet);
  const role = roleMatch?.[1] ?? null;

  if (role === null) {
    return { role: null, accessibleName: null };
  }

  const rest = withoutBullet.slice(role.length);

  // A quoted name binds to the role only when it precedes any colon; after a
  // colon the remainder is content.
  const colonIndex = rest.indexOf(':');
  const searchable = colonIndex === -1 ? rest : rest.slice(0, colonIndex);
  const nameMatch = /"((?:[^"\\]|\\.)*)"/.exec(searchable);

  return {
    role,
    accessibleName: nameMatch?.[1] === undefined ? null : nameMatch[1].replace(/\\(.)/g, '$1'),
  };
}
