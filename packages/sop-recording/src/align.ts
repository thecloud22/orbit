import type { ElementFingerprint, SelectorChain } from '@orbit/execution-mapping';

import { withoutFocusClicks } from './normalize';

/**
 * Lining a single walkthrough up against the steps somebody already drafted.
 *
 * The problem this solves is a person with nine unbound steps being asked to
 * bind them one at a time — open a browser, perform one action, save, re-aim,
 * perform one action, save. The alternative is that they perform the whole
 * task once, the way they would actually do it, and Orbit works out which
 * captured interaction belongs to which drafted step.
 *
 * Three properties matter more than cleverness here:
 *
 *   - **Deterministic.** Kind and order, nothing else. No model is called from
 *     this file, and none can be: the function is synchronous, so a network
 *     call cannot be hidden in it. `boundary.test.ts` pins the package's
 *     dependencies alongside that.
 *   - **Explainable.** Greedy, in order, first match wins. A person reviewing
 *     the result can check it by counting: the first fill they performed is the
 *     first fill in the draft. A globally optimal alignment would match more
 *     steps in awkward cases and nobody could predict what it would do.
 *   - **Silent when unsure.** A step with no clean match gets nothing, and says
 *     so. A confidently wrong element is worse than a blank, because the blank
 *     is obviously unfinished and the wrong element looks finished.
 *
 * Nothing here writes anything. It returns what it believes, and a person
 * accepts or rejects each one — the same posture recovery takes (ADR-033), for
 * the same reason: alignment can be wrong.
 */

/** One interaction from the walkthrough, as alignment needs it. */
export type DemonstratedEntry =
  | { readonly kind: 'navigate'; readonly url: string }
  | {
      /**
       * `pick` is a person pointing at a value to read rather than acting on
       * it. The capture engine reports it as its own kind because pointing must
       * not fire the page's handlers, and an `extract` step is bound from one.
       */
      readonly kind: 'click' | 'fill' | 'pick';
      readonly selectors: SelectorChain;
      readonly fingerprint: ElementFingerprint;
      /** For a fill: what was typed. Absent for a password field. */
      readonly typedValue?: string;
      readonly sensitive?: boolean;
      /** Where the page was, which a navigate binding would record. */
      readonly url?: string;
    };

/** The drafted step, reduced to what alignment actually reads. */
export interface AlignableStep {
  readonly id: string;
  readonly kind: string;
}

/**
 * Why a step came out of a walkthrough with nothing proposed for it.
 *
 * Separate reasons rather than one "no match", because they call for different
 * things from the person reading them: a decision needs the branch-by-branch
 * flow, and an unmatched action needs either another walkthrough or a
 * one-step binding session.
 */
export type AlignmentRefusal = 'decision_needs_each_branch' | 'nothing_matched';

export type StepAlignment =
  | {
      readonly kind: 'matched';
      readonly stepId: string;
      readonly stepKind: string;
      readonly entry: DemonstratedEntry;
      /** Index into the normalized sequence, so a reviewer can be shown where. */
      readonly entryIndex: number;
    }
  | {
      readonly kind: 'unmatched';
      readonly stepId: string;
      readonly stepKind: string;
      readonly refusal: AlignmentRefusal;
      readonly message: string;
    };

export interface AlignmentResult {
  /** One entry per step offered, in the workflow's own order. */
  readonly alignments: readonly StepAlignment[];
  /** The sequence the alignment actually ran against, focus clicks removed. */
  readonly sequence: readonly DemonstratedEntry[];
  /** Captures nothing claimed — a stray click, a page nobody drafted a step for. */
  readonly unusedCaptures: number;
}

/**
 * The captured kind a drafted step is demonstrated by.
 *
 * `navigate` and `outcome` are absent because the compiler requires no binding
 * for either — a navigation names a destination the graph already carries, and
 * an outcome touches no element — so offering to align them would be offering
 * work that changes nothing. `decision` is absent for a different reason
 * entirely, handled below.
 */
const CAPTURED_KIND_FOR_STEP: Readonly<Record<string, DemonstratedEntry['kind']>> = {
  fill: 'fill',
  click: 'click',
  extract: 'pick',
};

const DECISION_MESSAGE =
  'A decision has more than one outcome and a walkthrough follows one path, so it cannot show ' +
  'both. Bind this step branch by branch: put the page into each state in turn and point at the ' +
  'element that proves it.';

const NOTHING_MATCHED_MESSAGE: Readonly<Record<string, string>> = {
  fill: 'Nothing left in the walkthrough was a value typed into a field.',
  click: 'Nothing left in the walkthrough was a click.',
  extract: 'Nothing left in the walkthrough was a value pointed at to be read.',
};

/**
 * Aligns one walkthrough onto the steps it was meant to demonstrate.
 *
 * `steps` is the set the caller is offering to bind — in the workflow's own
 * order, and already narrowed to steps that have no binding. Alignment does not
 * decide what is worth binding; it decides which interaction is which.
 */
export function alignDemonstration(input: {
  readonly steps: readonly AlignableStep[];
  readonly sequence: readonly DemonstratedEntry[];
}): AlignmentResult {
  const sequence = withoutFocusClicks(input.sequence);
  const claimed = new Set<number>();
  const alignments: StepAlignment[] = [];

  // Advances only past what has been claimed, so a stray click sitting between
  // two real steps is skipped rather than blocking everything after it.
  let cursor = 0;

  for (const step of input.steps) {
    if (step.kind === 'decision') {
      alignments.push({
        kind: 'unmatched',
        stepId: step.id,
        stepKind: step.kind,
        refusal: 'decision_needs_each_branch',
        message: DECISION_MESSAGE,
      });
      continue;
    }

    const wanted = CAPTURED_KIND_FOR_STEP[step.kind];

    if (wanted === undefined) {
      alignments.push({
        kind: 'unmatched',
        stepId: step.id,
        stepKind: step.kind,
        refusal: 'nothing_matched',
        message: `A "${step.kind}" step is not something a walkthrough demonstrates.`,
      });
      continue;
    }

    const index = findFrom(sequence, cursor, wanted);

    if (index === null) {
      alignments.push({
        kind: 'unmatched',
        stepId: step.id,
        stepKind: step.kind,
        refusal: 'nothing_matched',
        message: NOTHING_MATCHED_MESSAGE[step.kind] ?? 'Nothing left in the walkthrough matched.',
      });
      continue;
    }

    claimed.add(index);
    cursor = index + 1;

    alignments.push({
      kind: 'matched',
      stepId: step.id,
      stepKind: step.kind,
      entry: sequence[index]!,
      entryIndex: index,
    });
  }

  return {
    alignments,
    sequence,
    unusedCaptures: sequence.filter(
      (entry, index) => entry.kind !== 'navigate' && !claimed.has(index),
    ).length,
  };
}

/** The first capture of this kind at or after `from`. */
function findFrom(
  sequence: readonly DemonstratedEntry[],
  from: number,
  wanted: DemonstratedEntry['kind'],
): number | null {
  for (let index = from; index < sequence.length; index += 1) {
    if (sequence[index]?.kind === wanted) {
      return index;
    }
  }

  return null;
}
