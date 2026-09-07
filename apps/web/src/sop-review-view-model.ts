import type { SopReviewView } from '@orbit/api/views';

import type { ApiRequestError } from './api-client';

/**
 * Every decision the review UI makes, as pure functions.
 *
 * Same arrangement as `run-view-model.ts` and `sop-draft-view-model.ts`: the
 * components render what these return and decide nothing themselves.
 *
 * Note what is *not* here. Which lifecycle actions are legal is computed on the
 * server from `SOP_REVISION_TRANSITIONS` and arrives in `availableActions`;
 * this file only labels them. A second copy of that table in the UI is exactly
 * what the brief forbids, and it would be free to drift from the one the
 * repository enforces.
 */

/**
 * Why publishing is not available yet.
 *
 * Nobody is asked to submit a workflow for review or to approve it — publishing
 * drives the whole lifecycle itself (ADR-028). One precondition still belongs
 * in front of a person rather than inside a refusal: a clarification the
 * generator asked for and nobody answered. Publishing would refuse on it, and
 * saying so up front is better than saying so after the click.
 *
 * Derived from the unanswered questions directly rather than from which
 * lifecycle actions the server offers, because no lifecycle action is on offer
 * here any more.
 */
export function publishBlockedReason(review: SopReviewView): string | null {
  const unanswered = review.unansweredQuestionIds.length;

  if (unanswered === 0) {
    return null;
  }

  return unanswered === 1
    ? 'One clarification question still needs an answer before this workflow can be published.'
    : `${unanswered} clarification questions still need answers before this workflow can be published.`;
}

export const REVIEW_STATE_LABELS: Readonly<Record<string, string>> = {
  draft: 'Draft',
  needs_clarification: 'Needs clarification',
  in_review: 'In review',
  approved: 'Approved',
  rejected: 'Rejected',
  superseded: 'Superseded',
};

export function stateLabel(state: string): string {
  return REVIEW_STATE_LABELS[state] ?? state;
}

export type ReviewFailureKind = 'rejected_change' | 'conflict' | 'request_failed';

export interface ReviewFailure {
  readonly kind: ReviewFailureKind;
  readonly title: string;
  readonly message: string;
  readonly issues: readonly { readonly where: string; readonly message: string }[];
}

/**
 * Turns a failed review action into something a reviewer can act on.
 *
 * A rejected reorder or edit (422) carries a sentence written for a person and
 * is shown as-is. A 409 is a state problem — the revision moved on, or the
 * question was already answered — which needs a different response from the
 * reader: reload rather than rewrite.
 */
export function describeReviewFailure(error: ApiRequestError): ReviewFailure {
  const issues = error.details.map((detail) => ({
    where: detail.field,
    message: detail.message,
  }));

  if (error.status === 422) {
    return {
      kind: 'rejected_change',
      title: 'That change was not saved',
      message: error.message,
      issues,
    };
  }

  if (error.status === 409) {
    return {
      kind: 'conflict',
      title: 'This revision has moved on',
      message: error.message,
      issues: [],
    };
  }

  return {
    kind: 'request_failed',
    title: 'The request was not accepted',
    message: error.message,
    issues,
  };
}

/**
 * The fields the editor shows for a step kind.
 *
 * Declared as data so the editor is a renderer rather than a switch statement
 * seven branches deep, and so "which fields does a decision have?" is a
 * testable question. There is deliberately no `json` field kind: the brief
 * requires structured fields only.
 */
export type StepFieldSpec =
  | {
      readonly kind: 'text';
      readonly name: string;
      readonly label: string;
      readonly required: boolean;
    }
  | {
      readonly kind: 'textarea';
      readonly name: string;
      readonly label: string;
      readonly required: boolean;
    }
  | { readonly kind: 'boolean'; readonly name: string; readonly label: string }
  | {
      readonly kind: 'select';
      readonly name: string;
      readonly label: string;
      readonly options: readonly string[];
    }
  | { readonly kind: 'stringList'; readonly name: string; readonly label: string }
  | { readonly kind: 'branches'; readonly name: string; readonly label: string }
  | { readonly kind: 'extractFields'; readonly name: string; readonly label: string }
  | { readonly kind: 'returns'; readonly name: string; readonly label: string };

const PURPOSE: StepFieldSpec = {
  kind: 'textarea',
  name: 'purpose',
  label: 'Why this step exists',
  required: true,
};

const OPTIONAL_PURPOSE: StepFieldSpec = { ...PURPOSE, required: false };

const FIELDS_BY_KIND: Readonly<Record<string, readonly StepFieldSpec[]>> = {
  navigate: [
    {
      kind: 'text',
      name: 'urlHint',
      label: 'Address or page (a draft reference, never opened)',
      required: false,
    },
    { kind: 'text', name: 'systemHint', label: 'System', required: false },
    PURPOSE,
  ],
  fill: [
    {
      kind: 'text',
      name: 'fieldHint',
      label: 'Field, as it is labelled on screen',
      required: true,
    },
    {
      kind: 'text',
      name: 'value',
      label: 'Value — literal text, or ${inputs.x} / ${variables.y}',
      required: true,
    },
    { kind: 'boolean', name: 'sensitive', label: 'This field takes a secret' },
    PURPOSE,
  ],
  click: [
    {
      kind: 'text',
      name: 'targetHint',
      label: 'Control, as it is labelled on screen',
      required: true,
    },
    PURPOSE,
  ],
  extract: [
    { kind: 'extractFields', name: 'fields', label: 'Values to collect' },
    {
      kind: 'select',
      name: 'onMissing',
      label: 'If a value is missing',
      options: ['fail', 'continue_with_note'],
    },
    PURPOSE,
  ],
  decision: [
    { kind: 'textarea', name: 'question', label: 'The question being decided', required: true },
    { kind: 'stringList', name: 'usesInputs', label: 'Run inputs it reads' },
    { kind: 'stringList', name: 'usesVariables', label: 'Variables it reads' },
    { kind: 'branches', name: 'branches', label: 'Branches' },
    OPTIONAL_PURPOSE,
  ],
  outcome: [
    { kind: 'text', name: 'outcome', label: 'Outcome name', required: true },
    { kind: 'textarea', name: 'message', label: 'Message', required: true },
    { kind: 'returns', name: 'returns', label: 'Values returned' },
    OPTIONAL_PURPOSE,
  ],
  manual_review: [
    { kind: 'text', name: 'reason', label: 'Reason', required: true },
    { kind: 'textarea', name: 'message', label: 'Message', required: true },
    {
      kind: 'textarea',
      name: 'handoff',
      label: 'Who picks this up, and what they do',
      required: false,
    },
    OPTIONAL_PURPOSE,
  ],
};

export function fieldsForStepKind(kind: string): readonly StepFieldSpec[] {
  return FIELDS_BY_KIND[kind] ?? [];
}

export const EDITABLE_STEP_KINDS = Object.keys(FIELDS_BY_KIND);

/**
 * Drops empty optional values before the step is sent.
 *
 * The graph schema is strict and several fields are `.min(1).optional()`, so an
 * emptied text box must become an absent key rather than an empty string —
 * otherwise clearing an optional field would be rejected as a schema error
 * instead of doing what the reviewer plainly meant.
 */
export function pruneEmptyFields(step: Record<string, unknown>): Record<string, unknown> {
  const pruned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(step)) {
    if (typeof value === 'string' && value.trim() === '') {
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      continue;
    }
    if (value === undefined || value === null) {
      continue;
    }
    pruned[key] = value;
  }

  return pruned;
}
