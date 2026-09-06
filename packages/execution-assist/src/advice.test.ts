import { buttonFingerprint, statusFingerprint } from '@orbit/execution-mapping/testing';
import type { SelectorChain } from '@orbit/execution-mapping';
import { describe, expect, it } from 'vitest';

import {
  adviseOnCoverage,
  adviseOnSelectors,
  narrowDriftCandidates,
  robustnessRank,
} from './advice';

const TEST_ID = { strategy: 'test_id', value: 'search-request-button' } as const;
const ROLE = { strategy: 'role_and_name', value: 'button', name: 'Search' } as const;
const LABEL = { strategy: 'label', value: 'Search' } as const;

describe('selector robustness — deterministic', () => {
  it('never consults a model', () => {
    // Ranking three known strategies is a fixed order, not a judgement. All of
    // these are plain function calls with no provider anywhere.
    expect(adviseOnSelectors([TEST_ID, ROLE]).every((advice) => !advice.fromModel)).toBe(true);
  });

  it('ranks a test id above a role above a label', () => {
    expect(robustnessRank(TEST_ID)).toBeLessThan(robustnessRank(ROLE));
    expect(robustnessRank(ROLE)).toBeLessThan(robustnessRank(LABEL));
  });

  it('says nothing about a chain that is already in the best order', () => {
    const advice = adviseOnSelectors([TEST_ID, ROLE, LABEL] as SelectorChain);
    expect(advice.filter((entry) => entry.message.includes('different order'))).toEqual([]);
  });

  it('suggests reordering a chain that leads with its weakest option', () => {
    const advice = adviseOnSelectors([LABEL, TEST_ID] as SelectorChain);
    const reorder = advice.find((entry) => entry.message.includes('different order'));

    expect(reorder).toBeDefined();
    expect(reorder?.message).toContain('test_id=search-request-button');
  });

  it('warns that a lone selector has nothing to fall back on', () => {
    const advice = adviseOnSelectors([LABEL] as SelectorChain);
    const warning = advice.find((entry) => entry.message.includes('nothing to fall back'));

    expect(warning?.severity).toBe('warning');
  });

  it('is gentler about a lone test id, which is the strongest option', () => {
    const advice = adviseOnSelectors([TEST_ID] as SelectorChain);
    expect(advice.find((entry) => entry.message.includes('nothing to fall back'))?.severity).toBe(
      'info',
    );
  });
});

describe('coverage — deterministic', () => {
  const steps = [
    { stepId: 'a', label: 'Open the portal', bindable: true, hasBinding: true },
    { stepId: 'b', label: 'Search for the request', bindable: true, hasBinding: false },
    { stepId: 'c', label: 'Send it to a person', bindable: false, hasBinding: false },
  ];

  it('never consults a model', () => {
    expect(adviseOnCoverage(steps).every((advice) => !advice.fromModel)).toBe(true);
  });

  it('names the steps that still need recording', () => {
    const advice = adviseOnCoverage(steps);

    expect(advice[0]?.severity).toBe('warning');
    expect(advice[0]?.message).toContain('Search for the request');
  });

  it('does not report an unbindable step as a gap', () => {
    // A manual_review step will never have a binding, and reporting that
    // permanent correct state as missing coverage would be noise forever.
    expect(adviseOnCoverage(steps)[0]?.message).not.toContain('Send it to a person');
    expect(adviseOnCoverage(steps)[0]?.message).toContain('1 step');
  });

  it('says so when everything bindable is bound', () => {
    const done = steps.map((step) => ({ ...step, hasBinding: step.bindable }));
    expect(adviseOnCoverage(done)[0]?.severity).toBe('info');
  });
});

describe('narrowDriftCandidates', () => {
  it('prefers candidates that share the expected role', () => {
    const same = { selectors: [TEST_ID] as SelectorChain, fingerprint: buttonFingerprint() };
    const different = { selectors: [ROLE] as SelectorChain, fingerprint: statusFingerprint() };

    expect(narrowDriftCandidates(buttonFingerprint(), [same, different])).toEqual([same]);
  });

  it('keeps everything rather than nothing when no role matches', () => {
    const different = { selectors: [ROLE] as SelectorChain, fingerprint: statusFingerprint() };
    expect(narrowDriftCandidates(buttonFingerprint(), [different])).toEqual([different]);
  });
});
