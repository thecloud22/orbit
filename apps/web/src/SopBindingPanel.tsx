import type { SopBindingsView, SopReviewStepView } from '@orbit/api/views';

import {
  bindingRows,
  isFullyApproved,
  summarizeBindings,
  type BindingRow,
  type BindingTone,
} from './sop-binding-view-model';

export interface SopBindingPanelProps {
  readonly steps: readonly SopReviewStepView[];
  readonly bindings: SopBindingsView | null;
}

const TONE_CLASSES: Readonly<Record<BindingTone, string>> = {
  neutral: 'bg-slate-100 text-slate-700',
  progress: 'bg-sky-50 text-sky-900',
  success: 'bg-emerald-50 text-emerald-900',
  attention: 'bg-amber-50 text-amber-900',
  muted: 'bg-slate-50 text-slate-500',
};

/**
 * Which steps have been mapped to a real page, and how far each one got.
 *
 * Read-only, and it will stay that way. Recording a binding means a person
 * demonstrating a step in a browser, which a web page cannot witness — so
 * creating, confirming and approving one all happen in the recorder CLI
 * (ADR-019). This panel exists so that someone reviewing the workflow can at
 * least see whether that work has been done, which until now they could not.
 */
export function SopBindingPanel({ steps, bindings }: SopBindingPanelProps) {
  const rows = bindingRows(steps, bindings);

  if (rows.length === 0) {
    return null;
  }

  const summary = summarizeBindings(bindings);

  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
      data-testid="sop-bindings"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Mapping to a real page</h3>
        {isFullyApproved(bindings) && (
          <span
            className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-900"
            data-testid="sop-bindings-complete"
          >
            Every step approved
          </span>
        )}
      </div>

      {summary !== null && (
        <p className="mt-1 text-xs text-slate-600" data-testid="sop-bindings-summary">
          {summary}
        </p>
      )}

      <p className="mt-1 text-xs text-slate-500">
        Bindings are recorded with <span className="font-mono">pnpm record:binding</span>. They
        cannot be created or changed from here.
      </p>

      <ul className="mt-3 flex flex-col gap-2">
        {rows.map((row) => (
          <BindingRowItem key={row.stepId} row={row} />
        ))}
      </ul>
    </section>
  );
}

function BindingRowItem({ row }: { readonly row: BindingRow }) {
  return (
    <li
      className="rounded-md border border-slate-200 p-3 transition-colors hover:border-slate-300"
      data-testid="sop-binding-row"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm text-slate-900">
          <span className="mr-2 text-xs text-slate-500">{row.position}.</span>
          <span className="mr-2 font-mono text-xs text-slate-500">{row.kind}</span>
          <span data-testid="sop-binding-step">{row.label}</span>
        </p>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[row.status.tone]}`}
          data-testid={`sop-binding-status-${row.stepId}`}
        >
          {row.status.label}
        </span>
      </div>

      <p className="mt-1 text-xs text-slate-600" data-testid="sop-binding-detail">
        {row.status.detail}
      </p>

      {row.binding.supersededCount > 0 && (
        <p className="mt-1 text-xs text-slate-500" data-testid="sop-binding-history">
          Re-recorded {row.binding.supersededCount}{' '}
          {row.binding.supersededCount === 1 ? 'time' : 'times'}.
        </p>
      )}

      {row.binding.selectors !== null && (
        <div className="mt-2" data-testid="sop-binding-selectors">
          <p className="text-xs font-medium text-slate-700">How the element is found, in order:</p>
          <ol className="mt-1 list-decimal pl-5 text-xs text-slate-700">
            {row.binding.selectors.map((selector) => (
              <li key={`${selector.strategy}:${selector.value}:${selector.name ?? ''}`}>
                <span className="font-mono">
                  {selector.strategy}={selector.value}
                  {selector.name === null ? '' : ` "${selector.name}"`}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {row.binding.fingerprint !== null && (
        <p className="mt-2 text-xs text-slate-600" data-testid="sop-binding-fingerprint">
          Approved as: {row.binding.fingerprint.role ?? 'unknown role'}
          {row.binding.fingerprint.accessibleName === null
            ? ''
            : ` "${row.binding.fingerprint.accessibleName}"`}
        </p>
      )}

      {row.binding.issues.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-amber-900" data-testid="sop-binding-issues">
          {row.binding.issues.map((issue) => (
            <li key={issue.code}>{issue.message}</li>
          ))}
        </ul>
      )}
    </li>
  );
}
