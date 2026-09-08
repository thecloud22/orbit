import type { SelectorChain } from '@orbit/execution-mapping';
import { buttonFingerprint, fieldFingerprint } from '@orbit/execution-mapping/testing';
import { describe, expect, it } from 'vitest';

import { withoutFocusClicks, type NormalizableEntry } from './normalize';

const FIELD = [{ strategy: 'test_id', value: 'request-number-input' }] as SelectorChain;
const OTHER_FIELD = [{ strategy: 'test_id', value: 'assignee-input' }] as SelectorChain;
const BUTTON = [{ strategy: 'test_id', value: 'search-request-button' }] as SelectorChain;

function click(selectors: SelectorChain, role = 'textbox'): NormalizableEntry {
  return { kind: 'click', selectors, fingerprint: { ...fieldFingerprint(), role } };
}

function fill(selectors: SelectorChain): NormalizableEntry {
  return { kind: 'fill', selectors, fingerprint: fieldFingerprint() };
}

describe('removing the interactions nobody meant to perform', () => {
  it('drops the click that only put the cursor in the field about to be filled', () => {
    const kept = withoutFocusClicks([click(FIELD), fill(FIELD)]);

    expect(kept.map((entry) => entry.kind)).toEqual(['fill']);
  });

  it('keeps a click on a field nobody then typed into', () => {
    // A real interaction: it might be the step. Only the click-then-type pair
    // is noise.
    const kept = withoutFocusClicks([click(FIELD), { kind: 'navigate', url: 'http://x/' }]);

    expect(kept.map((entry) => entry.kind)).toEqual(['click', 'navigate']);
  });

  it('keeps a click on one field when the fill that follows is a different one', () => {
    const kept = withoutFocusClicks([click(FIELD), fill(OTHER_FIELD)]);

    expect(kept).toHaveLength(2);
  });

  it('keeps a checkbox click, whose own click is what changed the value', () => {
    const kept = withoutFocusClicks([click(FIELD, 'checkbox'), fill(FIELD)]);

    expect(kept.map((entry) => entry.kind)).toEqual(['click', 'fill']);
  });

  it('keeps a click on a button, which no fill follows', () => {
    const kept = withoutFocusClicks([
      click(FIELD),
      fill(FIELD),
      { kind: 'click', selectors: BUTTON, fingerprint: buttonFingerprint() },
    ]);

    expect(kept.map((entry) => entry.kind)).toEqual(['fill', 'click']);
  });

  it('drops the focus click of every field in a form, and nothing else', () => {
    const kept = withoutFocusClicks([
      { kind: 'navigate', url: 'http://portal/' },
      click(FIELD),
      fill(FIELD),
      click(OTHER_FIELD),
      fill(OTHER_FIELD),
      { kind: 'click', selectors: BUTTON, fingerprint: buttonFingerprint() },
    ]);

    expect(kept.map((entry) => entry.kind)).toEqual(['navigate', 'fill', 'fill', 'click']);
  });

  it('leaves a sequence with no noise in it exactly as it arrived', () => {
    const sequence = [
      fill(FIELD),
      { kind: 'click', selectors: BUTTON, fingerprint: buttonFingerprint() },
    ];

    expect(withoutFocusClicks(sequence)).toEqual(sequence);
  });
});
