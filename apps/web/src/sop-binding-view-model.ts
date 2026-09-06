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

  const { bindable, bound, approved, stale } = bindings.summary;

  if (bindable === 0) {
    return 'No step in this workflow needs a binding.';
  }

  const parts = [`${approved} of ${bindable} steps approved`];

  if (bound > approved) {
    parts.push(`${bound - approved} recorded but not yet approved`);
  }

  if (stale > 0) {
    parts.push(`${stale} out of date`);
  }

  return `${parts.join(', ')}.`;
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
