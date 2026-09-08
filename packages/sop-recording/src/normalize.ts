import type { ElementFingerprint, SelectorChain } from '@orbit/execution-mapping';

/**
 * Removing the interactions a person did not mean to perform.
 *
 * Clicking into a text box before typing in it is one action to the person and
 * two to the page: a `click` on the field, then a `change` when the value is
 * committed. Both are captured, faithfully, because the capture engine reports
 * what the document reported and deliberately decides nothing.
 *
 * Deciding is this file's job, and it is here — in the pure package both the
 * recording translator and the demonstration aligner already depend on — so
 * there is one rule about what counts as noise rather than one per caller.
 * Two would drift, and the symptom of drift would be a recorded workflow and
 * an auto-bound workflow disagreeing about how many steps the same
 * demonstration contains.
 *
 * The rule is narrow on purpose. Only a click *immediately* followed by a fill
 * on the *same element* is dropped, and only when that element is not a toggle.
 * Everything else survives, including a click on a field that is never typed
 * into — which is a real interaction, and might be the step.
 */

/** The shape this rule needs. Both `RecordedEntry` and a picked entry satisfy it. */
export interface NormalizableEntry {
  readonly kind: string;
  readonly selectors?: SelectorChain;
  readonly fingerprint?: ElementFingerprint;
}

/**
 * Roles whose value is changed *by* clicking, so the click is the action.
 *
 * A checkbox reports a `change` for the same click that toggled it. Dropping
 * that click would leave a "fill" for a control nobody fills, so these are
 * excluded from the rule and keep both captures — which is the pre-existing
 * behaviour, and the safe direction: a spurious extra step is visible in
 * review, a missing one is not.
 */
const TOGGLE_ROLES: ReadonlySet<string> = new Set([
  'checkbox',
  'radio',
  'switch',
  'menuitemcheckbox',
  'menuitemradio',
]);

/** Whether two captures name the same element, by the chain that was derived for it. */
function sameElement(left: NormalizableEntry, right: NormalizableEntry): boolean {
  if (left.selectors === undefined || right.selectors === undefined) {
    return false;
  }

  if (left.selectors.length !== right.selectors.length) {
    return false;
  }

  return left.selectors.every((locator, index) => {
    const other = right.selectors?.[index];

    return (
      other !== undefined &&
      other.strategy === locator.strategy &&
      other.value === locator.value &&
      (other.name ?? null) === (locator.name ?? null)
    );
  });
}

/**
 * Whether this entry is a click that only put the cursor in the next entry's field.
 *
 * Note what is *not* consulted: the tag name. A `change` event is reported only
 * for an input, textarea or select, so "the next capture is a fill on this same
 * element" already establishes that the element is a form control. The role is
 * consulted for one thing only — telling a text box from a toggle.
 */
export function isFocusClick(
  entry: NormalizableEntry,
  next: NormalizableEntry | undefined,
): boolean {
  if (entry.kind !== 'click' || next === undefined || next.kind !== 'fill') {
    return false;
  }

  if (!sameElement(entry, next)) {
    return false;
  }

  const role = entry.fingerprint?.role;

  return role === null || role === undefined || !TOGGLE_ROLES.has(role);
}

/**
 * The captured sequence with focus clicks removed, in order.
 *
 * Everything else is kept exactly as it arrived, including navigations and
 * clicks that happened to hit a field nobody typed into.
 */
export function withoutFocusClicks<T extends NormalizableEntry>(
  sequence: readonly T[],
): readonly T[] {
  return sequence.filter((entry, index) => !isFocusClick(entry, sequence[index + 1]));
}
