import type { Locator } from '@orbit/agent-ir';
import {
  describeSelector,
  type ElementFingerprint,
  type SelectorChain,
} from '@orbit/execution-mapping';

/**
 * Advice, and what that word means here.
 *
 * Every function in this package is advisory. None auto-applies a change, none
 * blocks a save, and none touches the drift check's pass/fail logic — that is
 * 4a's runtime code and is not this package's business. A human reads these and
 * decides.
 *
 * Two of the four assists need no model at all, and deliberately do not have
 * one. Ranking three known strategies is a fixed order; asking whether a step
 * has a binding is a set difference. Reaching for a model where a deterministic
 * check answers the question would make an exact answer approximate.
 */

export type AdviceSeverity = 'info' | 'warning';

export interface Advice {
  readonly kind: 'selector_robustness' | 'coverage' | 'semantic_mismatch' | 'drift_recovery';
  readonly severity: AdviceSeverity;
  readonly message: string;
  /** Present when a model produced it, so a reader knows what they are reading. */
  readonly fromModel: boolean;
}

/** Most robust first. A test id is placed deliberately; a label moves with copy. */
const STRATEGY_ROBUSTNESS: Readonly<Record<Locator['strategy'], number>> = {
  test_id: 0,
  role_and_name: 1,
  label: 2,
};

export function robustnessRank(locator: Locator): number {
  return STRATEGY_ROBUSTNESS[locator.strategy];
}

/**
 * Selector robustness — deterministic.
 *
 * Sorting a chain by a fixed order and noticing it has no fallback are both
 * exact questions. The recorder has already verified every entry resolves
 * uniquely to the right element, so what is left is ordering and depth.
 */
export function adviseOnSelectors(chain: SelectorChain): readonly Advice[] {
  const advice: Advice[] = [];

  const ideal = [...chain].sort((left, right) => robustnessRank(left) - robustnessRank(right));
  const isOrdered = ideal.every((locator, index) => locator === chain[index]);

  if (!isOrdered) {
    advice.push({
      kind: 'selector_robustness',
      severity: 'info',
      message: `Consider trying these in a different order — ${ideal
        .map(describeSelector)
        .join(', then ')} — since a test id survives a redesign more often than a label does.`,
      fromModel: false,
    });
  }

  if (chain.length === 1) {
    const only = chain[0];
    advice.push({
      kind: 'selector_robustness',
      severity: only !== undefined && only.strategy === 'test_id' ? 'info' : 'warning',
      message:
        'This binding has only one way of finding its element, so there is nothing to fall back ' +
        'on if the page stops matching it.',
      fromModel: false,
    });
  }

  return advice;
}

export interface StepCoverage {
  readonly stepId: string;
  readonly label: string;
  readonly bindable: boolean;
  readonly hasBinding: boolean;
}

/**
 * Coverage — deterministic.
 *
 * Which steps still need a binding is a set difference, and `manual_review`
 * steps are excluded because they are not bindable at all: reporting them as
 * missing coverage would be reporting a permanent, correct state as a gap.
 */
export function adviseOnCoverage(steps: readonly StepCoverage[]): readonly Advice[] {
  const missing = steps.filter((step) => step.bindable && !step.hasBinding);

  if (missing.length === 0) {
    return [
      {
        kind: 'coverage',
        severity: 'info',
        message: 'Every step that can be bound has a binding.',
        fromModel: false,
      },
    ];
  }

  // Named a few and counted the rest: listing every unrecorded step in a
  // twenty-six step workflow is a wall of text, not a summary.
  const named = missing.slice(0, 3).map((step) => `"${step.label}"`);
  const remainder = missing.length - named.length;

  return [
    {
      kind: 'coverage',
      severity: 'warning',
      message: `${missing.length} step${missing.length === 1 ? '' : 's'} still need${
        missing.length === 1 ? 's' : ''
      } recording: ${named.join(', ')}${remainder > 0 ? `, and ${remainder} more` : ''}.`,
      fromModel: false,
    },
  ];
}

/** Candidates for a drift replacement, generated deterministically. */
export interface DriftCandidate {
  readonly selectors: SelectorChain;
  readonly fingerprint: ElementFingerprint;
}

/**
 * Narrows drift candidates before any model sees them.
 *
 * Which elements on the page could plausibly replace the one that vanished is a
 * matching problem a model is good at, but *finding* the elements is not — so
 * candidates are collected and filtered here, and only the ranking is asked of
 * a model.
 */
export function narrowDriftCandidates(
  expected: ElementFingerprint,
  candidates: readonly DriftCandidate[],
): readonly DriftCandidate[] {
  const sameRole = candidates.filter(
    (candidate) => expected.role !== null && candidate.fingerprint.role === expected.role,
  );

  return sameRole.length > 0 ? sameRole : candidates;
}
