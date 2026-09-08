import type { DriftObservation } from '@orbit/runtime';
import { describe, expect, it } from 'vitest';

import { diagnoseDrift } from './diagnose';

/**
 * Diagnosis, with no browser, no database and no model.
 *
 * Every case here is a pure function call, which is the point being made as
 * much as the assertions are: what recovery *believes* is decidable from a
 * fingerprint comparison and a list of locators, and it either has an answer or
 * says so.
 */
const APPROVED = {
  role: 'button',
  accessibleName: 'Borrow',
  text: 'Borrow',
  boundingBox: { x: 0, y: 0, width: 120, height: 32 },
};

const FAILED = { strategy: 'test_id' as const, value: 'catalog-borrow-button' };
const FALLBACK = { strategy: 'role_and_name' as const, value: 'button', name: 'Borrow' };
const LABEL = { strategy: 'label' as const, value: 'Borrow' };

function observation(overrides: Partial<DriftObservation> = {}): DriftObservation {
  return {
    context: {
      runId: 'run_1' as DriftObservation['context']['runId'],
      agentVersionId: 'agentv_1' as DriftObservation['context']['agentVersionId'],
      agentId: 'library',
      agentStepId: 'borrow_title',
    },
    bindingId: 'execbind_1',
    mode: 'action',
    expected: APPROVED,
    failedLocator: FAILED,
    failure: 'unresolved',
    observed: null,
    mismatches: [],
    candidates: [],
    ...overrides,
  };
}

describe('diagnosing UI drift', () => {
  it('is synchronous, which is how "no model call" is a property and not a promise', () => {
    // A synchronous function cannot await a network round trip. Switching
    // ranking on means changing this signature, and that is a change a reviewer
    // sees (ADR-033).
    const result = diagnoseDrift(observation());

    expect(result).not.toBeInstanceOf(Promise);
    expect(result.recoverable).toBe(false);
  });

  it('proposes when exactly one fallback still finds the approved element', () => {
    const result = diagnoseDrift(
      observation({
        candidates: [{ locator: FALLBACK, resolved: true, fingerprint: APPROVED }],
      }),
    );

    expect(result.recoverable).toBe(true);

    if (result.recoverable) {
      expect(result.confidence).toBe('high');
      expect(result.replacement).toEqual(FALLBACK);
      // The dead test id is dropped rather than demoted: keeping an entry known
      // to find nothing would make every future run pay for it first.
      expect(result.proposedSelectors).toEqual([FALLBACK]);
      expect(result.summary).toContain('renaming the element rather than replacing it');
    }
  });

  it('refuses when more than one candidate still matches', () => {
    // The refusal the whole design turns on: choosing between plausible
    // replacements is the judgement this version will not make.
    const result = diagnoseDrift(
      observation({
        candidates: [
          { locator: FALLBACK, resolved: true, fingerprint: APPROVED },
          { locator: LABEL, resolved: true, fingerprint: APPROVED },
        ],
      }),
    );

    expect(result.recoverable).toBe(false);

    if (!result.recoverable) {
      expect(result.reason).toBe('ambiguous');
      expect(result.summary).toContain('demonstrate this step again');
    }
  });

  it('refuses when the surviving candidate is a different element', () => {
    const result = diagnoseDrift(
      observation({
        candidates: [
          {
            locator: FALLBACK,
            resolved: true,
            fingerprint: { ...APPROVED, accessibleName: 'Place a hold' },
          },
        ],
      }),
    );

    expect(result.recoverable).toBe(false);
    expect(result.recoverable === false && result.reason).toBe('no_candidate');
  });

  it('refuses when the binding named its element only one way', () => {
    const result = diagnoseDrift(observation({ candidates: [] }));

    expect(result.recoverable).toBe(false);

    if (!result.recoverable) {
      expect(result.reason).toBe('no_candidate');
      expect(result.summary).toContain('only one way');
    }
  });

  it('ignores a candidate that no longer resolves', () => {
    const result = diagnoseDrift(
      observation({
        candidates: [
          { locator: FALLBACK, resolved: false, fingerprint: null },
          { locator: LABEL, resolved: true, fingerprint: APPROVED },
        ],
      }),
    );

    expect(result.recoverable).toBe(true);
    expect(result.recoverable === true && result.replacement).toEqual(LABEL);
  });

  it('handles the mismatch shape as well as the unresolved one', () => {
    // The head resolved, but to something else. A fallback that still finds
    // what was approved is just as good an explanation.
    const result = diagnoseDrift(
      observation({
        failure: 'mismatched',
        observed: { ...APPROVED, accessibleName: 'Reserve' },
        mismatches: [{ field: 'accessibleName', expected: 'Borrow', observed: 'Reserve' }],
        candidates: [{ locator: FALLBACK, resolved: true, fingerprint: APPROVED }],
      }),
    );

    expect(result.recoverable).toBe(true);
    expect(result.evidence.observed).toMatchObject({ accessibleName: 'Reserve' });
  });

  it('compares a read target the way the drift check does, ignoring text', () => {
    // A read target's text is the value the workflow extracts and changes every
    // run by design. Comparing it here would manufacture an ambiguity that the
    // runtime itself does not see.
    const result = diagnoseDrift(
      observation({
        mode: 'read',
        expected: { ...APPROVED, role: 'definition', text: 'In Progress' },
        candidates: [
          {
            locator: FALLBACK,
            resolved: true,
            fingerprint: { ...APPROVED, role: 'definition', text: 'Closed' },
          },
        ],
      }),
    );

    expect(result.recoverable).toBe(true);
  });

  it('records what it checked, and nothing about the page beyond it', () => {
    const result = diagnoseDrift(
      observation({
        candidates: [{ locator: FALLBACK, resolved: true, fingerprint: APPROVED }],
      }),
    );

    expect(result.evidence.failedLocator).toBe('test_id=catalog-borrow-button');
    expect(result.evidence.checked).toEqual([
      { locator: 'role_and_name=button "Borrow"', resolved: true, matchesApproved: true },
    ]);
  });
});
