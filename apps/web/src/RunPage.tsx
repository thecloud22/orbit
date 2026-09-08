import type { RunDetailView } from '@orbit/api/views';

import { ApiErrorNotice } from './ApiErrorNotice';
import type { ApiRequestError } from './api-client';
import { RunStatusPanel } from './RunStatusPanel';
import { RunTimeline } from './RunTimeline';

export interface RunPageProps {
  readonly run: RunDetailView | null;
  readonly error: ApiRequestError | null;
  readonly isRefreshing: boolean;
  readonly isStarting: boolean;
  readonly pollingStopped: boolean;
  readonly onRefresh: () => void;
}

/**
 * One run, on its own page.
 *
 * Starting a run used to leave you looking at the same trigger form it came
 * from, with the result appended underneath. A run is the thing being
 * inspected here — status, outcome, steps, events, evidence — and it gets a
 * page of its own rather than sharing one with the button that created it.
 *
 * Below the status panel there is now one timeline rather than three parallel
 * lists. Evidence is no longer a section of its own: a screenshot is rendered
 * under the step that captured it, which is the question a reader actually has
 * when they look at one (ADR-031). `RunTimeline` owns that join.
 */
export function RunPage({
  run,
  error,
  isRefreshing,
  isStarting,
  pollingStopped,
  onRefresh,
}: RunPageProps) {
  return (
    <section className="flex flex-col gap-4" data-testid="run-page">
      <h2 className="text-base font-semibold text-slate-900">Run</h2>

      {error !== null && (
        <ApiErrorNotice
          error={error}
          testId="run-request-error"
          title="The request was not accepted"
        />
      )}

      {run !== null && (
        <>
          <RunStatusPanel
            isRefreshing={isRefreshing}
            onRefresh={onRefresh}
            pollingStopped={pollingStopped}
            run={run}
          />
          <RunTimeline run={run} />
        </>
      )}

      {run === null && isStarting && (
        <p className="text-sm text-slate-600" data-testid="run-starting">
          Starting the run…
        </p>
      )}

      {run === null && !isStarting && error === null && (
        <p className="text-sm text-slate-600" data-testid="run-loading">
          Loading the run…
        </p>
      )}
    </section>
  );
}
