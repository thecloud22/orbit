import type { SopBindingsView, SopReviewStepView } from '@orbit/api/views';

import {
  bindActionLabel,
  bindingRows,
  canBindStep,
  isFullyApproved,
  summarizeBindings,
  type BindingRow,
  type BindingTone,
} from './sop-binding-view-model';

export interface SopBindingPanelProps {
  readonly steps: readonly SopReviewStepView[];
  readonly bindings: SopBindingsView | null;
  /** Opens a browser aimed at this step, or points an open one at it. */
  readonly onBind: (stepId: string) => void;
  readonly isStarting: boolean;
  /** Where a new browser would open. Null while a session is already open. */
  readonly startUrl: string | null;
  readonly onStartUrlChange: (startUrl: string) => void;
}

const TONE_CLASSES: Readonly<Record<BindingTone, string>> = {
  neutral: 'bg-slate-100 text-slate-700',
  progress: 'bg-sky-50 text-sky-900',
  success: 'bg-emerald-50 text-emerald-900',
  attention: 'bg-amber-50 text-amber-900',
  muted: 'bg-slate-50 text-slate-500',
};

/**
 * Which steps have been mapped to a real page, how far each one got, and how
 * to map one that has not been.
 *
 * Binding a step means a person demonstrating it in a real browser. There are
 * two ways to do that and neither is the other's fallback: the recorder CLI
 * (ADR-019), and a binding session started from here, which opens the browser
 * on the machine running Orbit (ADR-027).
 *
 * What this panel still offers no way to do is approve or reject somebody
 * else's binding, or bind a step that routes to a person. The first is review
 * this phase does not have a surface for; the second is not a thing a browser
 * can perform.
 */
export function SopBindingPanel({
  steps,
  bindings,
  onBind,
  isStarting,
  startUrl,
  onStartUrlChange,
}: SopBindingPanelProps) {
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
        <h3 className="text-sm font-semibold text-slate-900">What each step does on the page</h3>
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

      <p className="mt-2 text-sm text-slate-700" data-testid="sop-bindings-lead">
        The workflow above says <em>what</em> to do. This is <em>where</em> — someone showed Orbit,
        in a real browser, the exact box to type in and the exact button to press for each step.
        Until a step has been shown, Orbit does not know how to perform it and will not run it.
      </p>

      <p className="mt-1 text-xs text-slate-500">
        Show a step here, or from a terminal with{' '}
        <span className="font-mono">pnpm record:binding</span>. Either way a person does it once,
        for real. Approving or turning down what someone else recorded is not done from here.
      </p>

      {startUrl !== null && (
        <label className="mt-3 flex flex-col gap-1 text-xs text-slate-700">
          <span>Where the browser opens</span>
          <input
            className="w-full max-w-lg rounded-md border border-slate-300 px-2 py-1 text-sm"
            data-testid="binding-start-url"
            onChange={(event) => {
              onStartUrlChange(event.target.value);
            }}
            value={startUrl}
          />
        </label>
      )}

      <ul className="mt-3 flex flex-col gap-2">
        {rows.map((row) => (
          <BindingRowItem isStarting={isStarting} key={row.stepId} onBind={onBind} row={row} />
        ))}
      </ul>
    </section>
  );
}

function BindingRowItem({
  row,
  onBind,
  isStarting,
}: {
  readonly row: BindingRow;
  readonly onBind: (stepId: string) => void;
  readonly isStarting: boolean;
}) {
  // Open when the detail is the answer to a question the reader has: a stale
  // binding, a rejected one, or one the server raised issues about.
  const detailOpen = row.binding.stale || row.binding.issues.length > 0;

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

      {canBindStep(row) ? (
        <button
          className="mt-2 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-900 transition-colors hover:border-slate-400 disabled:text-slate-400"
          data-testid={`sop-binding-bind-${row.stepId}`}
          disabled={isStarting}
          onClick={() => {
            onBind(row.stepId);
          }}
          type="button"
        >
          {isStarting ? 'Opening a browser…' : bindActionLabel(row)}
        </button>
      ) : null}

      {row.binding.supersededCount > 0 && (
        <p className="mt-1 text-xs text-slate-500" data-testid="sop-binding-history">
          Re-recorded {row.binding.supersededCount}{' '}
          {row.binding.supersededCount === 1 ? 'time' : 'times'}.
        </p>
      )}

      {/*
        Folded away unless something is actually wrong with this binding.
        Selector chains and fingerprints are how the runtime finds an element —
        real, and worth being able to read — but they are engineering output,
        and a person publishing a workflow that is working has no decision to
        make from them. A stale or contested binding is the case where they
        stop being trivia and start being the answer, so that opens by default.
      */}
      {(row.binding.selectors !== null || row.binding.fingerprint !== null) && (
        <details className="mt-2" data-testid="sop-binding-locator" open={detailOpen}>
          <summary className="cursor-pointer text-xs text-slate-500 hover:text-indigo-600">
            How this element is found
          </summary>

          {row.binding.selectors !== null && (
            <div className="mt-2" data-testid="sop-binding-selectors">
              <p className="text-xs font-medium text-slate-700">In order:</p>
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
        </details>
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
