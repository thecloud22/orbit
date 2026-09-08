import type { Locator } from '@orbit/agent-ir';
import { narrowDriftCandidates, type DriftCandidate } from '@orbit/execution-assist';
import {
  compareFingerprint,
  describeSelector,
  type ElementFingerprint,
  type SelectorChain,
} from '@orbit/execution-mapping';
import type { DriftObservation } from '@orbit/runtime';

/**
 * Diagnosis: what a drifted step's own selector chain says happened.
 *
 * Deterministic, and **synchronous**, which is not a stylistic choice. A
 * synchronous function cannot make a network call, so "v1 consults no model" is
 * a property of this signature rather than a promise in a document. Switching
 * ranking on later means changing this type, which is a change that shows up in
 * review — exactly the property `permissions.model` gives a judged decision.
 *
 * The question it answers is narrow on purpose: *of the locators a person
 * already demonstrated for this element, does exactly one still find the
 * element they approved?* If yes, that is "the test id changed, the button did
 * not", and it is worth telling someone. If more than one does, or none does,
 * this refuses — because choosing between plausible replacements is judgement,
 * and judgement here would be a guess wearing a confidence score (ADR-033).
 */

/** Why a diagnosis reached no proposal. Mirrors the runtime's decline reasons. */
export type DiagnosisRefusal = 'no_candidate' | 'ambiguous' | 'not_recoverable';

export type DriftDiagnosis =
  | {
      readonly recoverable: true;
      /**
       * The single locator that still finds the approved element.
       *
       * `high` is the only confidence this version can reach, and it is a word
       * rather than a number deliberately: a float computed from a boolean test
       * would be false precision, and the moment one exists somebody will tune
       * a threshold against it.
       */
      readonly confidence: 'high';
      readonly replacement: Locator;
      /** The chain as it would read after accepting: dead locators removed. */
      readonly proposedSelectors: SelectorChain;
      readonly summary: string;
      readonly evidence: DiagnosisEvidence;
    }
  | {
      readonly recoverable: false;
      readonly reason: DiagnosisRefusal;
      readonly summary: string;
      readonly evidence: DiagnosisEvidence;
    };

/**
 * Why Orbit believes what it believes, in the words a reviewer needs.
 *
 * Element identity only — role, accessible name, the control's own label. Never
 * page content and never a value the workflow read: a proposal is displayed in
 * Studio and stored indefinitely, and neither is a place for whatever happened
 * to be on the page when a run failed.
 */
export interface DiagnosisEvidence {
  readonly failedLocator: string;
  readonly failure: DriftObservation['failure'];
  readonly approved: ElementFingerprint;
  readonly observed: ElementFingerprint | null;
  readonly checked: readonly {
    readonly locator: string;
    readonly resolved: boolean;
    readonly matchesApproved: boolean;
  }[];
}

/**
 * The reserved model seam, declared and unused (ADR-033).
 *
 * Ranking is what a model would be good at here and it is switched off: v1
 * handles the common case — one surviving locator, fingerprint identical to
 * what was approved — with no call, no cost and no run-to-run variation. This
 * type marks where a ranker would attach if that ever changes, so the shape is
 * agreed before anyone is under pressure to add one quickly. Nothing implements
 * it, nothing calls it, and `diagnoseDrift` cannot: it is not async.
 *
 * If it is ever implemented, the spend ledger and the three budget scopes in
 * @orbit/model-budget apply from the first call, as they do for the judge.
 */
export interface DriftCandidateRanker {
  rank(request: {
    readonly approved: ElementFingerprint;
    readonly candidates: readonly DriftCandidate[];
  }): Promise<{ readonly index: number; readonly confidence: number }>;
}

function locatorText(locator: Locator): string {
  return describeSelector(locator);
}

/**
 * Diagnoses one drift observation.
 *
 * The narrowing step is @orbit/execution-assist's `narrowDriftCandidates`,
 * which is where a model would eventually be handed a shortlist. It is used
 * here for the reason it was written — cutting the field down before anything
 * has to reason about it — and nothing reasons about it afterwards except an
 * exact fingerprint comparison.
 */
export function diagnoseDrift(observation: DriftObservation): DriftDiagnosis {
  const resolved = observation.candidates.filter(
    (candidate): candidate is typeof candidate & { fingerprint: ElementFingerprint } =>
      candidate.resolved && candidate.fingerprint !== null,
  );

  // The shortlist, then the decision — two steps, deliberately kept apart.
  //
  // `narrowDriftCandidates` is the shortlist a ranker would be handed, and it
  // is called here rather than at the moment ranking is switched on, so that
  // moment is a change to one filter and not a restructure. Said plainly: with
  // the exact-match filter below, narrowing by role currently removes nothing
  // the comparison would not also remove. It is not doing hidden work today. It
  // is the seam, in the position the seam belongs in.
  const plausible = narrowDriftCandidates(
    observation.expected,
    resolved.map((candidate) => ({
      selectors: [candidate.locator],
      fingerprint: candidate.fingerprint,
    })),
  );

  // The same comparison the drift check itself uses, in the same mode. That is
  // the point: a candidate "matches" precisely when the runtime would have
  // accepted it had the binding named it in the first place. A looser,
  // recovery-specific notion of "close enough" would be a second definition of
  // approval that no reviewer ever agreed to.
  const matching = plausible.filter(
    (candidate) =>
      compareFingerprint(observation.expected, candidate.fingerprint, observation.mode).matches,
  );

  const evidence: DiagnosisEvidence = {
    failedLocator: locatorText(observation.failedLocator),
    failure: observation.failure,
    approved: observation.expected,
    observed: observation.observed,
    checked: observation.candidates.map((candidate) => ({
      locator: locatorText(candidate.locator),
      resolved: candidate.resolved,
      matchesApproved:
        candidate.fingerprint !== null &&
        compareFingerprint(observation.expected, candidate.fingerprint, observation.mode).matches,
    })),
  };

  if (matching.length === 0) {
    return {
      recoverable: false,
      reason: 'no_candidate',
      summary:
        observation.candidates.length === 0
          ? 'This step names the element only one way, so there was nothing else to try. Someone needs to demonstrate it again.'
          : 'None of the other ways this step names its element finds what was approved. Someone needs to demonstrate it again.',
      evidence,
    };
  }

  if (matching.length > 1) {
    // The refusal the whole design turns on. More than one plausible
    // replacement is exactly the case a model would be asked to rank, and
    // exactly the case this version will not guess at.
    return {
      recoverable: false,
      reason: 'ambiguous',
      summary: `${String(matching.length)} different elements on the page still match what was approved, so Orbit will not choose between them. Someone needs to demonstrate this step again.`,
      evidence,
    };
  }

  const winner = matching[0]!;
  const replacement = winner.selectors[0]!;

  // Locators that no longer resolve are dropped rather than demoted. A chain
  // exists to be tried in order, and keeping an entry that is known to find
  // nothing would make every future run pay for it before falling through.
  const proposedSelectors: SelectorChain = [
    replacement,
    ...resolved
      .filter((candidate) => candidate.locator !== replacement)
      .map((candidate) => candidate.locator),
  ];

  return {
    recoverable: true,
    confidence: 'high',
    replacement,
    proposedSelectors,
    summary:
      `${locatorText(observation.failedLocator)} no longer finds this element, but ` +
      `${locatorText(replacement)} still finds one whose role, name and label are exactly what was approved. ` +
      'That reads as the page renaming the element rather than replacing it.',
    evidence,
  };
}
