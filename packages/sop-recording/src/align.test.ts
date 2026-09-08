import type { SelectorChain } from '@orbit/execution-mapping';
import {
  buttonFingerprint,
  fieldFingerprint,
  statusFingerprint,
} from '@orbit/execution-mapping/testing';
import { describe, expect, it } from 'vitest';

import { alignDemonstration, type AlignableStep, type DemonstratedEntry } from './align';

const FIELD = [{ strategy: 'test_id', value: 'request-number-input' }] as SelectorChain;
const BUTTON = [{ strategy: 'test_id', value: 'search-request-button' }] as SelectorChain;
const STATUS = [{ strategy: 'test_id', value: 'request-status' }] as SelectorChain;
const NAV_LINK = [{ strategy: 'test_id', value: 'nav-requests' }] as SelectorChain;

/**
 * The draft a person wrote with AI help: open the portal, type the number,
 * press search, read the status.
 */
const DRAFT: readonly AlignableStep[] = [
  { id: 'enter_request_number', kind: 'fill' },
  { id: 'search', kind: 'click' },
  { id: 'read_status', kind: 'extract' },
];

/**
 * What the browser actually reports when a person does that task, including
 * the click into the field that nobody thinks of as an action.
 */
const WALKTHROUGH: readonly DemonstratedEntry[] = [
  { kind: 'navigate', url: 'http://localhost:3001/requests' },
  { kind: 'click', selectors: FIELD, fingerprint: fieldFingerprint() },
  { kind: 'fill', selectors: FIELD, fingerprint: fieldFingerprint(), typedValue: 'SR-1001' },
  { kind: 'click', selectors: BUTTON, fingerprint: buttonFingerprint() },
  { kind: 'pick', selectors: STATUS, fingerprint: statusFingerprint() },
];

function align(
  steps: readonly AlignableStep[] = DRAFT,
  sequence: readonly DemonstratedEntry[] = WALKTHROUGH,
) {
  return alignDemonstration({ steps, sequence });
}

function matchedSelectors(result: ReturnType<typeof align>, stepId: string): SelectorChain | null {
  const alignment = result.alignments.find((entry) => entry.stepId === stepId);

  if (alignment?.kind !== 'matched' || alignment.entry.kind === 'navigate') {
    return null;
  }

  return alignment.entry.selectors;
}

describe('aligning one walkthrough onto a drafted workflow', () => {
  it('matches each step to the interaction that performed it', () => {
    const result = align();

    expect(result.alignments.map((entry) => entry.kind)).toEqual(['matched', 'matched', 'matched']);
    expect(matchedSelectors(result, 'enter_request_number')).toEqual(FIELD);
    expect(matchedSelectors(result, 'search')).toEqual(BUTTON);
    expect(matchedSelectors(result, 'read_status')).toEqual(STATUS);
  });

  it('does not mistake the click into the field for the click step', () => {
    // The defect this whole filter exists for: without it the draft's click
    // step binds to the text box, and the search button is never bound.
    const result = align();

    expect(matchedSelectors(result, 'search')).not.toEqual(FIELD);
    // The focus click is gone from the sequence entirely, so it cannot be
    // matched by anything later either.
    expect(result.sequence.filter((entry) => entry.kind === 'click')).toHaveLength(1);
  });

  it('proposes nothing for a step nobody performed, and says which kind was missing', () => {
    const draft: readonly AlignableStep[] = [
      ...DRAFT,
      { id: 'confirm_dialog', kind: 'click' },
      { id: 'enter_a_note', kind: 'fill' },
    ];

    const result = align(draft);
    const unmatched = result.alignments.filter((entry) => entry.kind === 'unmatched');

    expect(unmatched.map((entry) => entry.stepId)).toEqual(['confirm_dialog', 'enter_a_note']);
    expect(
      unmatched.every((entry) => entry.kind === 'unmatched' && entry.refusal === 'nothing_matched'),
    ).toBe(true);
    expect(unmatched[0]?.kind === 'unmatched' && unmatched[0].message).toContain('a click');
    expect(unmatched[1]?.kind === 'unmatched' && unmatched[1].message).toContain(
      'typed into a field',
    );
  });

  it('skips an interaction the draft has no step for rather than stopping there', () => {
    // A stray click on a navigation link, performed on the way. The draft has
    // no step for it, and the steps after it still align.
    const result = align(DRAFT, [
      WALKTHROUGH[0]!,
      { kind: 'click', selectors: NAV_LINK, fingerprint: buttonFingerprint() },
      ...WALKTHROUGH.slice(1),
    ]);

    expect(matchedSelectors(result, 'search')).toEqual(BUTTON);
    expect(result.unusedCaptures).toBe(1);
  });

  it('never proposes for a decision, and says why in words a person can act on', () => {
    const result = align([{ id: 'is_it_available', kind: 'decision' }]);
    const [alignment] = result.alignments;

    expect(alignment?.kind).toBe('unmatched');
    expect(alignment?.kind === 'unmatched' && alignment.refusal).toBe('decision_needs_each_branch');
    expect(alignment?.kind === 'unmatched' && alignment.message).toContain('branch by branch');
  });

  it('matches in order, so the second fill belongs to the second fill step', () => {
    const secondField = [{ strategy: 'test_id', value: 'assignee-input' }] as SelectorChain;

    const result = align(
      [
        { id: 'first', kind: 'fill' },
        { id: 'second', kind: 'fill' },
      ],
      [
        { kind: 'fill', selectors: FIELD, fingerprint: fieldFingerprint(), typedValue: 'SR-1001' },
        {
          kind: 'fill',
          selectors: secondField,
          fingerprint: fieldFingerprint(),
          typedValue: 'Ops',
        },
      ],
    );

    expect(matchedSelectors(result, 'first')).toEqual(FIELD);
    expect(matchedSelectors(result, 'second')).toEqual(secondField);
  });

  it('never claims one interaction for two steps', () => {
    const result = align([
      { id: 'first', kind: 'click' },
      { id: 'second', kind: 'click' },
    ]);

    const matched = result.alignments.filter((entry) => entry.kind === 'matched');

    expect(matched).toHaveLength(1);
    expect(result.alignments[1]?.kind).toBe('unmatched');
  });

  it('proposes nothing at all when the walkthrough is empty', () => {
    const result = align(DRAFT, []);

    expect(result.alignments.every((entry) => entry.kind === 'unmatched')).toBe(true);
    expect(result.unusedCaptures).toBe(0);
  });

  it('offers nothing for a kind no walkthrough demonstrates', () => {
    const result = align([{ id: 'ask_a_person', kind: 'manual_review' }]);

    expect(result.alignments[0]?.kind).toBe('unmatched');
    expect(result.alignments[0]?.kind === 'unmatched' && result.alignments[0].message).toContain(
      'not something a walkthrough demonstrates',
    );
  });
});
