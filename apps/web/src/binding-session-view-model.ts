import type {
  BindingSessionView,
  BindingTargetStepView,
  SopReviewStepView,
} from '@orbit/api/views';

import type { ApiRequestError } from './api-client';

/**
 * Every decision the binding-session UI makes, as pure functions.
 *
 * Same arrangement as the other view models here: components render what these
 * return and decide nothing themselves.
 */

export const BINDING_SESSION_EMPTY_MESSAGE =
  'Nothing captured yet. Do this one step in the browser window that just opened, and what you did appears here.';

export const BINDING_PICK_MESSAGE =
  'Click the value to read in the browser window — the page will not react — and it appears here.';

/**
 * The instruction for a decision, which is unlike every other kind.
 *
 * Every other step is demonstrated once. A decision is demonstrated once *per
 * branch*: put the page into that state first, then point at the thing that
 * proves you are in it. Saying which branch is being asked for is the whole
 * usability of this, so the branch text goes in the sentence.
 */
export function branchPickMessage(when: string): string {
  return `Put the page into the state where ${when}, then click the element that proves it. The page will not react.`;
}

export interface BindingCaptureRow {
  readonly captureId: string;
  readonly label: string;
  readonly kind: string;
  readonly sensitive: boolean;
}

/** What the person may choose between, newest last. */
export function captureRows(session: BindingSessionView | null): readonly BindingCaptureRow[] {
  if (session === null) {
    return [];
  }

  return session.captures.map((capture) => ({
    captureId: capture.captureId,
    label: capture.description,
    kind: capture.kind,
    sensitive: capture.sensitive,
  }));
}

/** The instruction line, which differs for a step that reads rather than acts. */
export function captureInstruction(session: BindingSessionView | null): string {
  const branch = session === null ? null : nextBranch(session.step);

  if (branch !== null) {
    return branchPickMessage(branch.when);
  }

  return session?.step.mode === 'pick' ? BINDING_PICK_MESSAGE : BINDING_SESSION_EMPTY_MESSAGE;
}

/**
 * The branch a decision is currently asking for, or null.
 *
 * The first one still missing an element, in the graph's own order, so the
 * person is walked through them in the sequence they read the workflow in.
 * Null once every branch is covered — and null for every kind that is not a
 * decision, which is what makes it safe to call unconditionally.
 */
export function nextBranch(
  step: BindingTargetStepView,
): { readonly when: string; readonly position: number; readonly total: number } | null {
  if (step.kind !== 'decision') {
    return null;
  }

  const index = step.branches.findIndex((branch) => !branch.captured);

  const branch = step.branches[index];

  return branch === undefined
    ? null
    : { when: branch.when, position: index + 1, total: step.branches.length };
}

/** How far through a decision's branches this sitting has got. */
export function branchProgress(step: BindingTargetStepView): string | null {
  if (step.kind !== 'decision' || step.branches.length === 0) {
    return null;
  }

  const captured = step.branches.filter((branch) => branch.captured).length;

  return captured === step.branches.length
    ? `All ${step.branches.length} branches demonstrated. Saving now writes the binding.`
    : `${captured} of ${step.branches.length} branches demonstrated.`;
}

export interface BindingFormFields {
  /**
   * A fill's value source is shown, not asked.
   *
   * The step already declares where its value comes from — that is what makes
   * this confirming a drafted step rather than re-authoring it — so the form
   * states it and the server derives the same thing from the same place.
   */
  readonly declaredValue: string | null;
  readonly sensitive: boolean;
  /** Which declared field an extract populates. Empty unless the step is one. */
  readonly variableOptions: readonly string[];
  /** True when the person must choose, because the step reads more than one value. */
  readonly needsVariableChoice: boolean;
}

export function formFieldsFor(step: BindingTargetStepView): BindingFormFields {
  return {
    declaredValue: step.kind === 'fill' ? step.declaredValue : null,
    sensitive: step.sensitive,
    variableOptions: step.kind === 'extract' ? step.fields : [],
    needsVariableChoice: step.kind === 'extract' && step.fields.length > 1,
  };
}

/**
 * A warning rather than a refusal.
 *
 * One binding reads one element, so a step declaring several fields cannot be
 * fully covered by a single binding. Saying so where the choice is made beats
 * letting someone bind one field and believe the step is done.
 */
export function multiFieldWarning(step: BindingTargetStepView): string | null {
  if (step.kind !== 'extract' || step.fields.length <= 1) {
    return null;
  }

  return `This step reads ${step.fields.length} values, and one binding reads one element. Bind the value the workflow depends on most; the rest are not covered yet.`;
}

/**
 * What the save button says.
 *
 * A decision's last branch writes the binding; the ones before it only record
 * a capture, and a button that said "Save this binding" three times would be
 * claiming to have saved something twice that it had not.
 */
export function saveButtonLabel(session: BindingSessionView | null): string {
  const branch = session === null ? null : nextBranch(session.step);

  return branch === null
    ? 'Save this binding'
    : branch.position === branch.total
      ? `Use this for "${branch.when}" and save`
      : `Use this for "${branch.when}"`;
}

/** Why "Save this binding" is not available yet, or null when it is. */
export function bindDisabledReason(input: {
  readonly session: BindingSessionView | null;
  readonly selectedCaptureId: string | null;
  readonly variable: string | null;
}): string | null {
  if (input.session === null) {
    return 'The binding session is still opening.';
  }

  if (input.session.captures.length === 0) {
    return 'Nothing has been captured yet.';
  }

  if (input.selectedCaptureId === null) {
    const branch = nextBranch(input.session.step);

    return branch === null
      ? 'Choose which capture was this step.'
      : `Choose the capture that shows "${branch.when}".`;
  }

  const fields = formFieldsFor(input.session.step);

  if (fields.needsVariableChoice && (input.variable === null || input.variable === '')) {
    return 'Choose which value this step reads.';
  }

  return null;
}

export type BindingFailureKind = 'gone' | 'refused' | 'in_use' | 'request_failed';

export interface BindingFailure {
  readonly kind: BindingFailureKind;
  readonly title: string;
  readonly message: string;
  /** True when the browser is still open, so the reader knows not to start over. */
  readonly sessionSurvived: boolean;
  readonly issues: readonly string[];
}

/**
 * Turns a failure into something a person mid-binding can act on.
 *
 * The distinction that matters is whether the browser survived: a refused
 * binding is fixable in place, a closed session is not.
 */
export function describeBindingSessionFailure(error: ApiRequestError): BindingFailure {
  if (error.status === 404) {
    return {
      kind: 'gone',
      title: 'That binding session is no longer open',
      message: error.message,
      sessionSurvived: false,
      issues: [],
    };
  }

  if (error.status === 410) {
    // Distinct from 409: 409 means a window is still open for this workflow,
    // 410 means the one that was open has been closed. Opposite problems, and
    // telling someone to close a window they already closed would be absurd.
    return {
      kind: 'gone',
      title: 'The recording browser was closed',
      message:
        'That window is gone, so this session cannot continue. Start binding again to open a new one.',
      sessionSurvived: false,
      issues: [],
    };
  }

  if (error.status === 409) {
    return {
      kind: 'in_use',
      title: 'This workflow already has a binding session open',
      message:
        'Finish or discard the browser window already open for this workflow before starting another.',
      sessionSurvived: true,
      issues: [],
    };
  }

  if (error.status === 422) {
    return {
      kind: 'refused',
      title: 'That binding was refused',
      message: error.message,
      sessionSurvived: true,
      issues: error.details.map((detail) => detail.message),
    };
  }

  return {
    kind: 'request_failed',
    title: 'The request was not accepted',
    message: error.message,
    sessionSurvived: true,
    issues: error.details.map((detail) => detail.message),
  };
}

/**
 * Where the browser opens, when the step itself does not say.
 *
 * A drafted `navigate` step carries a `urlHint`, but the step being bound is a
 * fill, click or extract, which carries no URL. Rather than guess, the panel
 * offers this and lets the person correct it — the same default the recorder
 * CLI suggests.
 */
export const DEFAULT_BINDING_START_URL = 'http://localhost:3001/requests';

/**
 * Where to suggest opening the browser for this workflow.
 *
 * A drafted `navigate` step carries the URL the workflow starts at, so the
 * workflow answers this itself when it can. It is a suggestion rather than a
 * decision: the field stays editable, because a hint written by a model is not
 * a fact about where the page actually is.
 */
export function suggestedStartUrl(steps: readonly SopReviewStepView[]): string {
  for (const step of steps) {
    if (step.kind === 'navigate') {
      const hint = step.step['urlHint'];

      if (typeof hint === 'string' && hint.trim() !== '') {
        return hint;
      }
    }
  }

  return DEFAULT_BINDING_START_URL;
}
