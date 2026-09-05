import type { RunDetailView } from '@orbit/api/views';

const STEP_STATUS_CLASSES: Record<string, string> = {
  pending: 'text-slate-500',
  running: 'text-sky-700',
  succeeded: 'text-emerald-700',
  failed: 'text-rose-700',
};

export interface RunTimelineProps {
  readonly run: RunDetailView;
}

/**
 * The expected-versus-observed timeline.
 *
 * Steps and events are rendered in their persisted order — `sequence`, never a
 * timestamp — because sequence is the ordering authority in the evidence
 * contract.
 */
export function RunTimeline({ run }: RunTimelineProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="rounded border border-slate-200 p-4" data-testid="step-timeline">
        <h3 className="text-sm font-semibold text-slate-900">Steps</h3>
        <ol className="mt-2 flex flex-col gap-1 text-sm">
          {run.steps.map((step) => (
            <li className="flex items-baseline gap-2" data-testid="step-row" key={step.id}>
              <span className="w-5 shrink-0 text-xs text-slate-400">{step.sequence}</span>
              <span className="grow font-medium text-slate-900">{step.agentStepId}</span>
              <span className="text-xs text-slate-500">{step.stepType}</span>
              <span
                className={`text-xs font-medium ${STEP_STATUS_CLASSES[step.status] ?? 'text-slate-500'}`}
                data-testid={`step-status-${step.agentStepId}`}
              >
                {step.status}
              </span>
            </li>
          ))}
          {run.steps.length === 0 && (
            <li className="text-sm text-slate-500">No steps have been recorded yet.</li>
          )}
        </ol>
      </section>

      <section className="rounded border border-slate-200 p-4" data-testid="event-timeline">
        <h3 className="text-sm font-semibold text-slate-900">Events</h3>
        <ol className="mt-2 flex max-h-96 flex-col gap-1 overflow-y-auto text-sm">
          {run.events.map((event) => (
            <li className="flex items-baseline gap-2" data-testid="event-row" key={event.id}>
              <span className="w-6 shrink-0 text-xs text-slate-400">{event.sequence}</span>
              <span className="grow font-mono text-xs text-slate-900">{event.eventType}</span>
              <span className="text-xs text-slate-500">{event.agentStepId ?? '—'}</span>
            </li>
          ))}
          {run.events.length === 0 && (
            <li className="text-sm text-slate-500">No events have been recorded yet.</li>
          )}
        </ol>
      </section>
    </div>
  );
}
