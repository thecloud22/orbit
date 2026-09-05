import type { RunDetailView } from '@orbit/api/views';

import {
  describeError,
  describeRunStatus,
  summarizeOutputs,
  summarizeProgress,
} from './run-view-model';

const TONE_CLASSES = {
  neutral: 'border-slate-300 bg-slate-50 text-slate-900',
  progress: 'border-sky-300 bg-sky-50 text-sky-900',
  success: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  attention: 'border-amber-300 bg-amber-50 text-amber-900',
  failure: 'border-rose-300 bg-rose-50 text-rose-900',
} as const;

export interface RunStatusPanelProps {
  readonly run: RunDetailView;
  readonly isRefreshing: boolean;
  readonly pollingStopped: boolean;
  readonly onRefresh: () => void;
}

/**
 * What the server says about this run.
 *
 * Everything shown here comes from the persisted run record. A successful HTTP
 * response is never, on its own, treated as a successful run.
 */
export function RunStatusPanel({
  run,
  isRefreshing,
  pollingStopped,
  onRefresh,
}: RunStatusPanelProps) {
  const status = describeRunStatus(run);
  const outputs = summarizeOutputs(run.outputs);
  const error = describeError(run.error);
  const progress = summarizeProgress(run);

  return (
    <section className="flex flex-col gap-4" data-testid="run-status-panel">
      <div className={`rounded border p-4 ${TONE_CLASSES[status.tone]}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold" data-testid="run-status-label">
            {status.label}
          </h2>
          <button
            className="rounded border border-current px-3 py-1 text-xs font-medium disabled:opacity-50"
            data-testid="refresh-run-button"
            disabled={isRefreshing}
            onClick={onRefresh}
            type="button"
          >
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        <p className="mt-1 text-sm" data-testid="run-status-detail">
          {status.detail}
        </p>

        <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="font-medium opacity-80">Run</dt>
          <dd data-testid="run-id">{run.id}</dd>
          <dt className="font-medium opacity-80">Agent version</dt>
          <dd data-testid="run-agent-version">
            {run.agentVersion.name} {run.agentVersion.version} ({run.agentVersion.id})
          </dd>
          <dt className="font-medium opacity-80">Business outcome</dt>
          <dd data-testid="run-business-outcome">{run.businessOutcome}</dd>
          <dt className="font-medium opacity-80">Steps completed</dt>
          <dd data-testid="run-progress">
            {progress.completedSteps} of {progress.totalSteps}
            {progress.failedStep === null ? '' : ` — failed at ${progress.failedStep}`}
          </dd>
        </dl>

        {pollingStopped && (
          <p className="mt-3 text-xs font-medium" data-testid="polling-stopped">
            Automatic refresh stopped. Use Refresh to check again.
          </p>
        )}
      </div>

      {outputs.length > 0 && (
        <div className="rounded border border-slate-200 p-4" data-testid="run-outputs">
          <h3 className="text-sm font-semibold text-slate-900">Output</h3>
          <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
            {outputs.map((output) => (
              <div className="contents" key={output.key}>
                <dt className="font-medium text-slate-600">{output.label}</dt>
                <dd className="text-slate-900" data-testid={`output-${output.key}`}>
                  {output.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {error !== null && (
        <div className="rounded border border-rose-300 bg-rose-50 p-4" data-testid="run-error">
          <h3 className="text-sm font-semibold text-rose-900">Technical failure</h3>
          <p className="mt-1 text-sm text-rose-900" data-testid="run-error-code">
            {error.code}
          </p>
          <p className="mt-1 text-sm text-rose-900" data-testid="run-error-message">
            {error.message}
          </p>
          {error.details.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-rose-900">
              {error.details.map((detail) => (
                <li key={`${detail.field}:${detail.message}`}>
                  <span className="font-medium">{detail.field}</span>: {detail.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
