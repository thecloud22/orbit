import type { WalkthroughSessionView, WalkthroughStepView } from '@orbit/api/views';

import type { ApiRequestError } from './api-client';

/**
 * Every decision the walkthrough panel makes, as pure functions (ADR-035).
 *
 * Same arrangement as the other view models here: the component renders what
 * these return and decides nothing. That matters more than usual on this
 * screen, because the interesting behaviour is entirely in the judgements —
 * which steps can still be accepted, what a step that got nothing should say,
 * and whether "accept everything" is a sensible thing to offer at all.
 */

/** Which half of the sitting a person is in. */
export type WalkthroughPhase = 'demonstrating' | 'reviewing';

export function phaseOf(session: WalkthroughSessionView): WalkthroughPhase {
  return session.outcome === null ? 'demonstrating' : 'reviewing';
}

export type ProposalTone = 'proposed' | 'accepted' | 'dismissed' | 'refused';

export interface WalkthroughRow {
  readonly stepId: string;
  readonly kind: string;
  readonly label: string;
  readonly tone: ProposalTone;
  /** The status word beside the step. */
  readonly statusLabel: string;
  /** The sentence under it: what was demonstrated, or why nothing was. */
  readonly detail: string;
  readonly proposalId: string | null;
  /** Whether this row still has a decision waiting on it. */
  readonly acceptable: boolean;
  /**
   * Whether this step needs the per-step binding flow instead.
   *
   * True for a decision, always, and for anything a walkthrough could not
   * account for. The button that follows it is the existing "Bind this step",
   * unchanged — this screen adds a faster route and replaces nothing.
   */
  readonly needsDemonstration: boolean;
}

const STATE_LABELS: Readonly<Record<string, string>> = {
  proposed: 'Proposed',
  accepted: 'Accepted',
  dismissed: 'Dismissed',
  gone: 'No longer there',
};

/**
 * Why a step got nothing, in words that say what to do next.
 *
 * The server sends a message for every refusal and this prefers it, because the
 * server knows things this does not — which of several fields a step reads, for
 * instance. These are the fallback, and the reason they exist at all is that a
 * message is prose and a `refusal` is a value a test can assert on.
 */
const REFUSAL_FALLBACKS: Readonly<Record<string, string>> = {
  decision_needs_each_branch:
    'A decision has more than one outcome and a walkthrough follows one path, so it cannot show both. Bind this one branch by branch.',
  nothing_matched:
    'Nothing left in the walkthrough matched this step. Demonstrate it on its own, or walk through the path that includes it.',
  needs_a_choice:
    'This step needs a judgement a walkthrough cannot make. Demonstrate it on its own and answer the question.',
  did_not_validate:
    'What the walkthrough showed does not fit this step, so nothing was proposed for it.',
  already_proposed:
    'A proposal for this step is already waiting to be reviewed, so this walkthrough left it alone.',
};

export function walkthroughRows(session: WalkthroughSessionView): readonly WalkthroughRow[] {
  if (session.outcome === null) {
    return [];
  }

  return session.outcome.steps.map(toRow);
}

function toRow(step: WalkthroughStepView): WalkthroughRow {
  if (step.proposalId === null) {
    return {
      stepId: step.stepId,
      kind: step.stepKind,
      label: step.summary,
      tone: 'refused',
      statusLabel: 'Nothing proposed',
      detail:
        step.message ??
        REFUSAL_FALLBACKS[step.refusal ?? ''] ??
        'Nothing was proposed for this step.',
      proposalId: null,
      acceptable: false,
      needsDemonstration: true,
    };
  }

  const state = step.state ?? 'proposed';

  return {
    stepId: step.stepId,
    kind: step.stepKind,
    label: step.summary,
    tone: state === 'accepted' ? 'accepted' : state === 'proposed' ? 'proposed' : 'dismissed',
    statusLabel: STATE_LABELS[state] ?? state,
    detail:
      state === 'accepted'
        ? `${step.demonstrated ?? 'The demonstrated element'} — now this step's approved mapping.`
        : (step.demonstrated ?? 'An element was proposed for this step.'),
    proposalId: step.proposalId,
    acceptable: state === 'proposed',
    // A dismissed proposal leaves the step unbound, so it still needs somebody.
    needsDemonstration: state === 'dismissed' || state === 'gone',
  };
}

/** The proposals "Accept them all" would act on, in the order they are shown. */
export function acceptableProposalIds(session: WalkthroughSessionView): readonly string[] {
  return walkthroughRows(session)
    .filter((row) => row.acceptable)
    .map((row) => row.proposalId as string);
}

export interface WalkthroughSummary {
  readonly headline: string;
  readonly detail: string | null;
}

/**
 * One sentence about what the walkthrough achieved, and one about what is left.
 *
 * Deliberately states the shortfall rather than only the win. A screen that
 * says "6 steps proposed" and stops leaves somebody believing the workflow is
 * ready when three steps still have nothing.
 */
export function summarizeWalkthrough(session: WalkthroughSessionView): WalkthroughSummary {
  if (session.outcome === null) {
    return {
      headline: `Perform the whole task in the browser Orbit opened. ${plural(
        session.awaitingBinding,
        'step',
      )} ${session.awaitingBinding === 1 ? 'is' : 'are'} waiting to be matched to what you do.`,
      detail: null,
    };
  }

  const rows = walkthroughRows(session);
  const outstanding = rows.filter((row) => row.needsDemonstration).length;
  const accepted = rows.filter((row) => row.tone === 'accepted').length;

  const headline =
    session.outcome.proposed === 0
      ? 'Orbit could not match anything you did to a step in this workflow.'
      : `Orbit matched ${plural(session.outcome.proposed, 'step')} to what you did.`;

  const parts: string[] = [];

  if (accepted > 0) {
    parts.push(`${plural(accepted, 'step')} accepted so far`);
  }

  if (outstanding > 0) {
    parts.push(
      `${plural(outstanding, 'step')} still ${outstanding === 1 ? 'needs' : 'need'} demonstrating on its own`,
    );
  }

  if (session.outcome.unusedCaptures > 0) {
    parts.push(
      `${plural(session.outcome.unusedCaptures, 'interaction')} you performed matched no step`,
    );
  }

  return { headline, detail: parts.length === 0 ? null : `${parts.join('; ')}.` };
}

/** `1 step` reads "1 step"; anything else takes an "s". */
export function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

export interface WalkthroughFailure {
  readonly kind: 'gone' | 'conflict' | 'refused' | 'unknown';
  readonly title: string;
  readonly message: string;
}

/**
 * What went wrong, in words a person can act on.
 *
 * `gone` is separated from everything else for the same reason the binding
 * panel separates it: a window somebody closed is not an error, it is the end
 * of a session, and the panel stops polling on it rather than showing a red box
 * that never clears.
 */
export function describeWalkthroughFailure(error: ApiRequestError): WalkthroughFailure {
  if (error.status === 410) {
    return {
      kind: 'gone',
      title: 'That browser window is gone',
      message: error.message,
    };
  }

  if (error.status === 404) {
    return {
      kind: 'gone',
      title: 'This walkthrough is no longer open',
      message:
        'Orbit stopped holding it — the API restarted, or it sat untouched too long. Anything it already proposed is still saved against the workflow.',
    };
  }

  if (error.status === 409) {
    return {
      kind: 'conflict',
      title: 'A walkthrough is already open for this workflow',
      message:
        'Finish or cancel the one that is open before starting another. Two browsers on one workflow would race each other.',
    };
  }

  if (error.status === 400 || error.status === 422) {
    return { kind: 'refused', title: 'That could not be done', message: error.message };
  }

  return {
    kind: 'unknown',
    title: 'The walkthrough could not be reached',
    message: error.message,
  };
}

/**
 * What a person is told about decisions, on the screen rather than in a doc.
 *
 * The exclusion is deliberate and permanent, not a gap: one walkthrough follows
 * one path, so it cannot demonstrate both sides of a branch. Somebody who is
 * not told this reads a decision's blank row as Orbit having failed.
 */
export const DECISION_NOTICE =
  'A decision cannot be bound from a walkthrough. One walkthrough follows one path through the ' +
  'workflow, and a decision needs an element for every branch — so those stay on the ' +
  'branch-by-branch flow: put the page into each state in turn and point at what proves it.';

/** Said before anyone starts, so the offer is not oversold. */
export const WALKTHROUGH_LEAD =
  'Perform the whole task once, the way you actually would. Orbit lines up what you did against ' +
  'the steps still waiting and proposes a mapping for each one it can account for. Nothing is ' +
  'saved until you accept it, and a step it gets wrong is re-demonstrated on its own.';
