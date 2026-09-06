import {
  describeSelector,
  type ElementFingerprint,
  type SelectorChain,
} from '@orbit/execution-mapping';

import {
  adviseOnCoverage,
  adviseOnSelectors,
  narrowDriftCandidates,
  type Advice,
  type DriftCandidate,
  type StepCoverage,
} from './advice';
import { AssistProviderError, type AssistProvider } from './provider';

/**
 * The four assists, composed.
 *
 * Two are pure functions re-exported from `advice.ts`; two consult a model. All
 * four return advice a human reads and may ignore — nothing here decides
 * anything, and a provider failure produces no advice rather than an error,
 * because a recording must not fail for want of a suggestion.
 */

export interface SemanticCheckInput {
  readonly stepPurpose: string;
  readonly stepKind: string;
  readonly fingerprint: ElementFingerprint;
  readonly selectors: SelectorChain;
}

/** Whether the captured element plausibly matches what the step says it does. */
export async function adviseOnSemanticMatch(
  provider: AssistProvider,
  input: SemanticCheckInput,
): Promise<readonly Advice[]> {
  try {
    const verdict = await provider.checkSemanticMatch(input);

    return [
      {
        kind: 'semantic_mismatch',
        severity: verdict.plausible ? 'info' : 'warning',
        message: verdict.reason,
        fromModel: true,
      },
    ];
  } catch (error) {
    return noAdvice(error);
  }
}

export interface DriftRecoveryInput {
  readonly stepPurpose: string;
  readonly expected: ElementFingerprint;
  readonly candidates: readonly DriftCandidate[];
}

/**
 * Suggests a replacement after a run stopped on drift.
 *
 * This is the loop that closes 2.4 back on 2.6's failures: a live run's
 * `UNEXPECTED_UI_STATE` and its evidence land here rather than in a dead end.
 * It never applies anything — re-recording is a human demonstrating the step
 * again, which is the only thing that produces a binding.
 */
export async function adviseOnDriftRecovery(
  provider: AssistProvider,
  input: DriftRecoveryInput,
): Promise<readonly Advice[]> {
  const narrowed = narrowDriftCandidates(input.expected, input.candidates);

  if (narrowed.length === 0) {
    return [
      {
        kind: 'drift_recovery',
        severity: 'warning',
        message: 'Nothing on the page now resembles the element this step was recorded against.',
        fromModel: false,
      },
    ];
  }

  try {
    const ranking = await provider.rankDriftCandidates({
      stepPurpose: input.stepPurpose,
      expected: input.expected,
      candidates: narrowed.map((candidate, index) => ({
        index,
        fingerprint: candidate.fingerprint,
      })),
    });

    const best = ranking.bestIndex === null ? undefined : narrowed[ranking.bestIndex];

    if (best === undefined) {
      return [
        {
          kind: 'drift_recovery',
          severity: 'warning',
          message: ranking.reason,
          fromModel: true,
        },
      ];
    }

    return [
      {
        kind: 'drift_recovery',
        severity: 'info',
        message: `${ranking.reason} Closest match: ${best.selectors
          .map(describeSelector)
          .join(', ')}. Re-record the step to confirm — this is a suggestion, not a change.`,
        fromModel: true,
      },
    ];
  } catch (error) {
    return noAdvice(error);
  }
}

/**
 * A provider failure yields no advice, never an error.
 *
 * A genuine defect still propagates: only a declared provider failure is
 * swallowed, so a bug in this process does not hide behind a message about a
 * missing suggestion.
 */
function noAdvice(error: unknown): readonly Advice[] {
  if (error instanceof AssistProviderError) {
    return [];
  }
  throw error;
}

export { adviseOnCoverage, adviseOnSelectors, type Advice, type StepCoverage, type DriftCandidate };
