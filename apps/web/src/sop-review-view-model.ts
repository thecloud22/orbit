import type { SopBindingsView, SopReviewView } from '@orbit/api/views';

import type { ApiRequestError } from './api-client';
import { isBindingRequired, isFullyBoundForPublish } from './sop-binding-view-model';

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

/**
 * Where this workflow has got to, as one value the whole page is laid out from.
 *
 * Every section used to decide independently whether to render, so a finished
 * workflow showed a publish panel, a walkthrough offer and a binding panel at
 * once — three surfaces competing to be the next thing to do, on a document
 * where the answer was "nothing". One derived phase makes that a single
 * decision, taken once, in a function a test can ask questions of.
 *
 * The order of the checks is the meaning. Published wins over everything,
 * because a running version is the most important true thing about a document
 * regardless of what its current revision looks like — including a revised one,
 * which is published *and* editable *and* fully bound simultaneously.
 */
export type ReviewPhase = 'drafting' | 'ready' | 'published';

export function reviewPhase(review: SopReviewView, bindings: SopBindingsView | null): ReviewPhase {
  if (review.publication.agentVersionId !== null) {
    return 'published';
  }

  return isFullyBoundForPublish(bindings) ? 'ready' : 'drafting';
}

export interface ReviewLead {
  readonly phase: ReviewPhase;
  readonly title: string;
  readonly body: string;
}

/**
 * The one thing the page leads with, in the phase's own terms.
 *
 * Drafting leads with what is missing, because that is the only question its
 * reader has. Ready leads with the action. Published leads with the fact that
 * something is running — and says, without being asked, that working here
 * cannot change it.
 */
export function reviewLead(review: SopReviewView, bindings: SopBindingsView | null): ReviewLead {
  const phase = reviewPhase(review, bindings);

  if (phase === 'published') {
    const version = review.publication.agentVersion ?? 'unknown';
    const unpublished = review.publication.compiledFromRevisionId !== review.revisionId;

    return {
      phase,
      title: `Running as version ${version}`,
      body: unpublished
        ? `Revision ${String(review.revisionNumber)} has not been published. Version ${version} keeps running exactly as it is until you publish again.`
        : 'This workflow is live. Everything below builds toward a new version; none of it changes what is running now.',
    };
  }

  if (phase === 'ready') {
    return {
      phase,
      title: 'Ready to publish',
      body: 'Every step that needs one has an approved, up-to-date mapping to a real page. Publishing turns this workflow into a runnable agent.',
    };
  }

  const remaining = unboundRequiredCount(bindings);

  return {
    phase,
    title: 'Not ready to run yet',
    body:
      remaining === null
        ? 'Orbit could not read how far this workflow has been mapped to a real page.'
        : remaining === 0
          ? 'No step of this workflow needs to be shown to Orbit in a browser yet.'
          : remaining === 1
            ? 'One step still has to be shown to Orbit in a real browser before this workflow can run.'
            : `${String(remaining)} steps still have to be shown to Orbit in a real browser before this workflow can run.`,
  };
}

/** Required steps with no approved, usable binding. Null when unknown. */
function unboundRequiredCount(bindings: SopBindingsView | null): number | null {
  if (bindings === null) {
    return null;
  }

  return bindings.steps.filter(
    (step) =>
      isBindingRequired(step.kind) &&
      !(step.status === 'approved' && !step.stale && step.issues.length === 0),
  ).length;
}

export interface ReviseConfirmation {
  readonly title: string;
  readonly points: readonly string[];
  readonly confirmLabel: string;
}

/**
 * What revising actually does, said before it is done.
 *
 * Three facts, because three things are reasonable to fear here and each is
 * false: that the published version will change, that the mappings will have to
 * be redone, and that the approved revision will be rewritten. See ADR-036.
 */
export function reviseConfirmation(review: SopReviewView): ReviseConfirmation {
  const version = review.publication.agentVersion;

  return {
    title: 'Make this workflow editable again?',
    points: [
      `This creates revision ${String(review.revisionNumber + 1)} as an editable copy. Revision ${String(review.revisionNumber)} is kept exactly as it was approved.`,
      'Every mapping already recorded is kept. Only a step you actually change has to be shown to Orbit again.',
      version === null
        ? 'Nothing that is running changes until you publish again.'
        : `Version ${version} keeps running, unchanged, until you publish again — and publishing then adds a new version rather than replacing it.`,
    ],
    confirmLabel: 'Create an editable revision',
  };
}

export interface ReviewProgressStep {
  readonly phase: ReviewPhase;
  readonly label: string;
  readonly status: 'done' | 'current' | 'upcoming';
}

/**
 * Where the revision on screen sits along Draft -> Ready to publish -> Published.
 *
 * Deliberately scoped to *this revision*, not the document. `reviewPhase`
 * answers "what is the most important true fact about this document", and
 * `published` wins there even for a freshly revised, unpublished draft
 * (ADR-036) -- exactly the case a progress bar must not claim is finished. A
 * stepper needs the narrower question: has *this* revision itself been
 * published, fully mapped, or neither.
 */
export function reviewProgress(
  review: SopReviewView,
  bindings: SopBindingsView | null,
): readonly ReviewProgressStep[] {
  const publishedAtThisRevision =
    review.publication.agentVersionId !== null &&
    review.publication.compiledFromRevisionId === review.revisionId;

  const currentIndex = publishedAtThisRevision ? 2 : isFullyBoundForPublish(bindings) ? 1 : 0;

  const steps: readonly { readonly phase: ReviewPhase; readonly label: string }[] = [
    { phase: 'drafting', label: 'Draft' },
    { phase: 'ready', label: 'Ready to publish' },
    { phase: 'published', label: 'Published' },
  ];

  return steps.map((step, index) => ({
    ...step,
    status: index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming',
  }));
}

/**
 * The header line naming this revision, or not, depending on whether that word
 * means anything yet.
 *
 * "Revision" is accurate the moment there is a second one -- an edit really
 * did fork the graph's history, publish or not -- and it is accurate the
 * moment something has published, because a future edit really would revise a
 * running thing. Neither is true yet for the untouched graph a recording or a
 * draft first lands as: revision 1, unedited, unpublished, with nothing behind
 * it to be a revision *of*. Calling that "Revision 1" implies a history that
 * does not exist; this is the one case that gets just the state instead.
 */
export function revisionHeadline(review: SopReviewView): string {
  const isUntouchedOriginal =
    review.revisionNumber === 1 && review.publication.agentVersionId === null;

  return isUntouchedOriginal
    ? stateLabel(review.state)
    : `Revision ${String(review.revisionNumber)} · ${stateLabel(review.state)}`;
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

export interface ReviewFailureIssue {
  readonly where: string;
  readonly message: string;
}

export interface ReviewFailure {
  readonly kind: ReviewFailureKind;
  readonly title: string;
  readonly message: string;
  readonly issues: readonly ReviewFailureIssue[];
}

/**
 * The one issue this page can actually fix on the spot, rather than only name.
 *
 * `[UNDECLARED_INPUT_REFERENCE]` is a code the API attaches to `message`
 * (`toIssueDetails` in `sop-revisions.ts`), and the input's own name is quoted
 * inside the plain-language sentence @orbit/sop-graph generates for it
 * (`validate.ts`: `uses the run input "<name>"`). Both ends are this
 * codebase's own, stable, single-purpose format -- not a third party's free
 * text -- which is what makes matching against it here reasonable rather than
 * fragile.
 *
 * This was the actual "not clear" complaint: the page already showed the right
 * information (which input, which step), just as a bracketed code and a JSON
 * path, with no way to act on it from where it was read. A person hit the same
 * fix three times running a curl command for them would not have taught them
 * anything about the fourth.
 */
const UNDECLARED_INPUT_PATTERN = /^\[UNDECLARED_INPUT_REFERENCE\] .*uses the run input "([^"]+)"/;

export function undeclaredInputRef(issue: ReviewFailureIssue): string | null {
  return UNDECLARED_INPUT_PATTERN.exec(issue.message)?.[1] ?? null;
}

/** Every distinct input name a failed edit named as undeclared, in order. */
export function undeclaredInputRefs(failure: ReviewFailure): readonly string[] {
  const seen = new Set<string>();

  for (const issue of failure.issues) {
    const name = undeclaredInputRef(issue);
    if (name !== null) {
      seen.add(name);
    }
  }

  return [...seen];
}

/** Issues the page has a specific recovery for, so they are not also shown as raw text. */
export function issuesWithoutRecovery(failure: ReviewFailure): readonly ReviewFailureIssue[] {
  return failure.issues.filter((issue) => undeclaredInputRef(issue) === null);
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
  call: [
    {
      kind: 'text',
      name: 'requestHint',
      label: 'What this asks for',
      required: true,
    },
    { kind: 'text', name: 'systemHint', label: 'Which system', required: true },
    { kind: 'text', name: 'purpose', label: 'Why this step exists', required: true },
  ],
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

export interface StepFieldContext {
  /**
   * Catalog ids of the API systems registered in Admin.
   *
   * Passed in rather than fetched here: this module is pure view-model logic and
   * the component that renders the form is what already knows how to load.
   */
  readonly apiSystems?: readonly string[];
}

export function fieldsForStepKind(
  kind: string,
  context: StepFieldContext = {},
): readonly StepFieldSpec[] {
  const specs = FIELDS_BY_KIND[kind] ?? [];

  if (kind !== 'call' || (context.apiSystems ?? []).length === 0) {
    // With nothing registered the field stays free text rather than becoming an
    // empty picker. An empty select tells a person their only option is
    // nothing; a text box at least lets them record the intent and register the
    // system afterwards.
    return specs;
  }

  return specs.map((spec) =>
    spec.name === 'systemHint'
      ? {
          kind: 'select' as const,
          name: 'systemHint',
          label: 'Which system',
          options: [...(context.apiSystems ?? [])],
        }
      : spec,
  );
}

export const EDITABLE_STEP_KINDS = Object.keys(FIELDS_BY_KIND);

/**
 * What each step kind is called, for a person choosing one.
 *
 * The picker used to render the internal identifier. That was survivable while
 * every kind was a browser verb -- `navigate`, `fill` and `click` happen to read
 * as English -- and stopped being survivable with `call`, which says nothing
 * about an API to anyone who has not read the schema. A vocabulary a business
 * user picks from should be in their words, not the type system's.
 */
export const STEP_KIND_LABELS: Readonly<Record<string, string>> = {
  navigate: 'Go to a page',
  fill: 'Type into a field',
  click: 'Click something',
  extract: 'Read values from the page',
  call: 'Call an API',
  decision: 'Branch on a condition',
  outcome: 'Finish with an outcome',
  manual_review: 'Hand off to a person',
};

/** The label for a kind, falling back to the identifier rather than to nothing. */
export function stepKindLabel(kind: string): string {
  return STEP_KIND_LABELS[kind] ?? kind;
}

/**
 * Turns `assignedTeam` into `Assigned team`, the way a person who wrote the
 * SOP would read it.
 *
 * The server's own `@orbit/sop-graph` has the same function, but `produces`
 * now carries raw identifiers rather than a prettified string (a client
 * offering one back as a value — a picker for what an outcome step returns —
 * needs the exact name), so display formatting moved here, to the one place
 * that still wants it.
 */
export function describeVariable(name: string): string {
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

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
