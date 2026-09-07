import type { SopBindingsView, SopReviewStepView, SopStepBindingView } from '@orbit/api/views';

/**
 * Every decision the binding panel makes, as pure functions.
 *
 * Same arrangement as the other view models here: components render what these
 * return and decide nothing themselves.
 *
 * Note what this file does *not* contain — a step label. That already reaches
 * the UI as `SopReviewStepView.summary`, computed by the single `describeStep`
 * call on the server, so the panel joins on `stepId` rather than rendering a
 * step's name a second time.
 */

export type BindingTone = 'neutral' | 'progress' | 'success' | 'attention' | 'muted';

export interface BindingStatusDescription {
  readonly label: string;
  readonly tone: BindingTone;
  readonly detail: string;
}

const STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: 'Recorded, not yet submitted',
  needs_review: 'Waiting for review',
  approved: 'Approved',
  rejected: 'Rejected',
};

/**
 * How one step's binding reads.
 *
 * Staleness is reported alongside the status rather than instead of it, because
 * they are different facts: an approved binding whose step has since changed is
 * still approved, and is still not safe to run. Collapsing the two would hide
 * whichever one came second.
 */
export function describeBindingStatus(entry: SopStepBindingView): BindingStatusDescription {
  if (!entry.bindable) {
    return {
      label: 'No binding needed',
      tone: 'muted',
      detail: 'This step routes to a person, so there is nothing to automate.',
    };
  }

  // A `navigate` step compiles from the workflow's own URL and an `outcome`
  // step touches no element, so neither is a step anyone has to demonstrate.
  // Reporting them as "Not recorded" made a workflow that was ready to publish
  // read as two-thirds finished and missing something.
  if (!isBindingRequired(entry.kind)) {
    return {
      label: 'No binding needed',
      tone: 'muted',
      detail:
        entry.kind === 'navigate'
          ? 'This step opens a page, which the workflow already names.'
          : 'This step acts on no element, so there is nothing to demonstrate.',
    };
  }

  if (entry.status === null) {
    return {
      label: 'Not recorded',
      tone: 'neutral',
      detail: 'No one has demonstrated this step yet.',
    };
  }

  const label = STATUS_LABELS[entry.status] ?? entry.status;

  if (entry.stale) {
    return {
      label: `${label} — out of date`,
      tone: 'attention',
      detail:
        'This step has changed since the binding was recorded, so it must be recorded again before it is used.',
    };
  }

  if (entry.status === 'approved') {
    return { label, tone: 'success', detail: 'Recorded and approved.' };
  }

  if (entry.status === 'rejected') {
    return { label, tone: 'attention', detail: 'A reviewer turned this binding down.' };
  }

  return { label, tone: 'progress', detail: 'Recorded, and not yet approved for use.' };
}

export interface BindingRow {
  readonly stepId: string;
  readonly position: number;
  /** From `SopReviewStepView.summary` — the one server-side renderer. */
  readonly label: string;
  readonly kind: string;
  readonly status: BindingStatusDescription;
  readonly binding: SopStepBindingView;
}

/**
 * Joins binding status onto the steps the review page already loaded.
 *
 * Ordered by the review page's own step order, so the panel reads in the same
 * sequence as the workflow above it. A binding for a step the current revision
 * no longer has is dropped rather than shown detached from anything.
 */
export function bindingRows(
  steps: readonly SopReviewStepView[],
  bindings: SopBindingsView | null,
): readonly BindingRow[] {
  if (bindings === null) {
    return [];
  }

  const byStep = new Map(bindings.steps.map((entry) => [entry.stepId, entry]));

  return steps.flatMap((step) => {
    const entry = byStep.get(step.id);

    if (entry === undefined) {
      return [];
    }

    return [
      {
        stepId: step.id,
        position: step.position,
        label: step.summary,
        kind: step.kind,
        status: describeBindingStatus(entry),
        binding: entry,
      },
    ];
  });
}

/** One sentence about how far mapping has got. */
export function summarizeBindings(bindings: SopBindingsView | null): string | null {
  if (bindings === null) {
    return null;
  }

  // Counted over the steps the compiler actually requires a binding for, not
  // over `summary.bindable`, which includes `navigate` and `outcome`. Counting
  // those made a fully mapped workflow report itself as incomplete — the
  // headline disagreeing with `isFullyBoundForPublish`, which has always
  // counted only the required kinds.
  const required = bindings.steps.filter((step) => isBindingRequired(step.kind));

  if (required.length === 0) {
    return 'No step in this workflow needs a binding.';
  }

  const approved = required.filter((step) => step.status === 'approved' && !step.stale).length;
  const bound = required.filter((step) => step.status !== null).length;
  const stale = required.filter((step) => step.stale).length;

  const parts = [`${approved} of ${required.length} steps ready`];

  if (bound > approved + stale) {
    parts.push(`${bound - approved - stale} recorded but not yet approved`);
  }

  if (stale > 0) {
    parts.push(`${stale} out of date`);
  }

  return `${parts.join(', ')}.`;
}

/**
 * The step kinds a binding session will map, which is exactly the set the
 * compiler requires a binding for.
 *
 * A `navigate` step compiles from the graph's own URL hint, a `manual_review`
 * step routes to a person, and an `outcome` step touches no element. Offering
 * to bind any of them would be offering work that changes nothing.
 *
 * `decision` joined the list once the compiler learned to emit
 * `browser.expect_one_of`: a decision now needs one demonstrated element per
 * branch, and without them a branching workflow cannot be published at all.
 *
 * Stated as a literal rather than imported from `@orbit/agent-ir-compiler`,
 * because Watchtower must not pull a compiler — with its `node:crypto` and its
 * database checksum import — into a browser bundle. The API is the authority;
 * this list only decides what to offer, and a disagreement surfaces as a
 * refusal from the server rather than as a wrong binding.
 */
export const WATCHTOWER_BINDABLE_KINDS: readonly string[] = [
  'fill',
  'click',
  'extract',
  'decision',
];

/**
 * Whether the compiler requires a binding for this kind of step.
 *
 * The one definition. Three things used to answer this separately — the
 * headline count, the per-step status label, and the publish gate — and they
 * disagreed: a workflow whose every required step was bound reported "6 of 9
 * steps approved" and showed its `navigate` step as "Not recorded", while the
 * publish button correctly considered it ready.
 */
export function isBindingRequired(kind: string): boolean {
  return WATCHTOWER_BINDABLE_KINDS.includes(kind);
}

/**
 * Whether this step can be bound from here, and is worth binding.
 *
 * An approved binding whose step has since changed still offers re-binding:
 * "approved" and "usable" are different facts (see `describeBindingStatus`),
 * and a stale binding is the case where they differ.
 */
export function canBindStep(row: BindingRow): boolean {
  if (!isBindingRequired(row.kind)) {
    return false;
  }

  return row.binding.status !== 'approved' || row.binding.stale;
}

/** "Bind" the first time, "Bind again" when replacing something. */
export function bindActionLabel(row: BindingRow): string {
  return row.binding.status === null ? 'Bind this step' : 'Bind this step again';
}

/**
 * Whether every step the compiler needs a binding for has a usable one.
 *
 * Derived from the rows the panel already has rather than from
 * `summary.bindable`, which counts every kind that *could* take a binding —
 * including `navigate` and `outcome`, which the compiler does not require one
 * for. This has to agree with the server's own gate
 * (`publish-bound-document-service.ts`) or the button would offer a publish the
 * API refuses.
 */
export function isFullyBoundForPublish(bindings: SopBindingsView | null): boolean {
  if (bindings === null) {
    return false;
  }

  const required = bindings.steps.filter((step) => isBindingRequired(step.kind));

  return (
    required.length > 0 &&
    required.every((step) => step.status === 'approved' && !step.stale && step.issues.length === 0)
  );
}

/** Whether the workflow is fully mapped, which is not the same as fully bound. */
export function isFullyApproved(bindings: SopBindingsView | null): boolean {
  return (
    bindings !== null &&
    bindings.summary.bindable > 0 &&
    bindings.summary.approved === bindings.summary.bindable &&
    bindings.summary.stale === 0
  );
}
