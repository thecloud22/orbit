import type { RunDetailView, RunEventView } from '@orbit/api/views';

import { EvidenceGroup } from '../shared/EvidenceList';
import {
  buildRunTimeline,
  humanizeEventType,
  humanizeStepType,
  stepDetails,
  type TimelineStep,
} from './run-timeline-view-model';

/** One muted colour per surface, so a mixed run is scannable without reading. */
const SURFACE_CLASSES: Record<'browser' | 'terminal' | 'api', string> = {
  browser: 'bg-sky-50 text-sky-700',
  terminal: 'bg-emerald-50 text-emerald-700',
  api: 'bg-violet-50 text-violet-700',
};

const STEP_STATUS_CLASSES: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-600',
  running: 'bg-sky-100 text-sky-800',
  succeeded: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-rose-100 text-rose-800',
};

const STEP_MARKER_CLASSES: Record<string, string> = {
  pending: 'border-slate-300 bg-white',
  running: 'border-sky-400 bg-sky-100',
  succeeded: 'border-emerald-400 bg-emerald-100',
  failed: 'border-rose-400 bg-rose-100',
};

export interface RunTimelineProps {
  readonly run: RunDetailView;
}

/**
 * One run, as one timeline.
 *
 * This was three lists — steps, events, evidence — rendered side by side, each
 * complete and each in its own order, which meant that answering "what happened
 * at the click, and what did the page look like afterwards?" required the
 * reader to join three lists by timestamp in their head. The data always
 * carried the answer: events and artifacts both name the step they belong to.
 *
 * So: one row per step, in `sequence` order, with that step's own events and
 * its own evidence underneath it. Run-level events keep their own group, since
 * `run.started` sitting between two steps read as though it were one of them.
 * The raw event stream is kept verbatim in a collapsed section — the join is a
 * reading aid, and the record it was derived from must stay available.
 *
 * Steps and events are rendered in their persisted order — `sequence`, never a
 * timestamp — because sequence is the ordering authority in the evidence
 * contract.
 */
export function RunTimeline({ run }: RunTimelineProps) {
  const timeline = buildRunTimeline(run);
  // A badge per step is only informative when there is more than one surface
  // to distinguish. Derived here rather than passed in, so the timeline stays
  // the thing that knows what it contains.
  const spansSurfaces =
    new Set(timeline.steps.map((entry) => entry.surface).filter((one) => one !== null)).size > 1;

  return (
    <div className="flex flex-col gap-4" data-testid="run-timeline">
      {timeline.runEvents.length > 0 && (
        <section
          className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
          data-testid="run-events"
        >
          <h3 className="text-sm font-semibold text-slate-900">The run</h3>
          <p className="mt-1 text-xs text-slate-500">
            What happened to the run as a whole, rather than inside any one step.
          </p>

          <ul className="mt-3 flex flex-col gap-1">
            {timeline.runEvents.map((event) => (
              <EventLine event={event} key={event.id} testId="run-event-row" />
            ))}
          </ul>
        </section>
      )}

      <section
        className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
        data-testid="step-timeline"
      >
        <h3 className="text-sm font-semibold text-slate-900">Steps</h3>
        <p className="mt-1 text-xs text-slate-500">
          Each step in order, with the events it emitted and the evidence it captured.
        </p>

        {timeline.steps.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No steps have been recorded yet.</p>
        ) : (
          <ol className="mt-4 flex flex-col">
            {timeline.steps.map((entry, index) => (
              <StepEntry
                entry={entry}
                isLast={index === timeline.steps.length - 1}
                showSurfaces={spansSurfaces}
                key={entry.step.id}
              />
            ))}
          </ol>
        )}
      </section>

      {/*
        The trace covers the whole session and belongs to no single step, so it
        gets its own place rather than being attached to an arbitrary one.
      */}
      <section
        className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
        data-testid="evidence-list"
      >
        <h3 className="text-sm font-semibold text-slate-900">Evidence for the whole run</h3>
        <EvidenceGroup
          emptyMessage="No run-wide evidence has been recorded for this run yet."
          items={timeline.runEvidence}
        />
      </section>

      {/*
        The record the timeline above was derived from, kept verbatim and kept
        in the document — collapsed, not removed. Joining events to steps is a
        reading aid; anyone debugging needs the stream exactly as persisted,
        including any event whose step is not in this run's step list.
      */}
      <details
        className="rounded-lg border border-slate-200 bg-white shadow-sm"
        data-testid="raw-event-stream"
      >
        <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-slate-700 hover:text-indigo-700">
          Raw event stream ({run.events.length})
        </summary>

        <ol className="max-h-96 overflow-y-auto border-t border-slate-200 px-5 py-4">
          {run.events.map((event) => (
            <li className="flex items-baseline gap-2 py-0.5" data-testid="event-row" key={event.id}>
              <span className="w-8 shrink-0 text-xs text-slate-400">{event.sequence}</span>
              <span className="grow font-mono text-xs text-slate-900">{event.eventType}</span>
              <span className="font-mono text-xs text-slate-500">{event.agentStepId ?? '—'}</span>
            </li>
          ))}
          {run.events.length === 0 && (
            <li className="text-sm text-slate-500">No events have been recorded yet.</li>
          )}
        </ol>
      </details>
    </div>
  );
}

/**
 * One step, with everything that belongs to it.
 *
 * Deliberately not collapsed. Collapsing would make the page shorter and would
 * put the evidence back behind a click — which is the problem this change
 * exists to solve. Density is managed instead by keeping each step's summary to
 * one line and by never loading a screenshot until it is asked for.
 */
function StepEntry({
  entry,
  isLast,
  showSurfaces,
}: {
  readonly entry: TimelineStep;
  readonly isLast: boolean;
  readonly showSurfaces: boolean;
}) {
  const { step, surface, events, evidence, branch, judged, durationLabel } = entry;
  const details = stepDetails(step);
  const hasBody =
    branch !== null ||
    judged !== null ||
    details.length > 0 ||
    events.length > 0 ||
    evidence.length > 0;

  return (
    <li className="flex gap-3" data-testid="step-row">
      {/* The rail: a marker per step, joined by a line so the order reads as a sequence. */}
      <div aria-hidden="true" className="flex flex-col items-center">
        <span
          className={`mt-1 h-3 w-3 shrink-0 rounded-full border-2 ${
            STEP_MARKER_CLASSES[step.status] ?? STEP_MARKER_CLASSES['pending']
          }`}
        />
        {!isLast && <span className="w-px grow bg-slate-200" />}
      </div>

      <div className={`min-w-0 grow ${isLast ? 'pb-0' : 'pb-5'}`}>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-xs text-slate-400">{step.sequence}</span>
          <span className="font-medium text-slate-900">{step.agentStepId}</span>
          <span className="text-xs text-slate-500">{humanizeStepType(step.stepType)}</span>
          {/*
            Shown only when a run actually spans surfaces. On a browser-only run
            -- every agent published before Phase 3 -- a badge on every step
            would be noise stating the one thing that never varies.
          */}
          {surface !== null && showSurfaces && (
            <span
              className={`rounded px-1.5 py-0.5 text-xs font-medium ${SURFACE_CLASSES[surface]}`}
              data-testid={`step-surface-${step.agentStepId}`}
            >
              {surface}
            </span>
          )}
          {durationLabel !== null && (
            <span className="text-xs text-slate-400">{durationLabel}</span>
          )}
          <span
            className={`ml-auto rounded px-2 py-0.5 text-xs font-medium ${
              STEP_STATUS_CLASSES[step.status] ?? 'bg-slate-100 text-slate-600'
            }`}
            data-testid={`step-status-${step.agentStepId}`}
          >
            {step.status}
          </span>
        </div>

        {branch !== null && (
          <p
            className="mt-2 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-900"
            data-testid="step-branch"
          >
            Took the <strong>{branch.matched}</strong> branch, and continued at{' '}
            <span className="font-mono text-xs">{branch.next}</span>.
          </p>
        )}

        {/*
          A judged decision reads differently from a deterministic one on
          purpose. There is no element that matched, so what describes it is the
          conclusion, how sure the model was, and the bar it had to clear —
          confidence beside its threshold, because 0.86 means nothing alone and
          everything next to the 0.8 it had to beat. The rationale is labelled
          as the model's own account: it is evidence for the reader and it
          decided nothing.
        */}
        {judged !== null && (
          <div
            className="mt-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900"
            data-testid="step-judged-decision"
          >
            <p>
              A model judged this <strong>{judged.outcome}</strong>, and the run continued at{' '}
              <span className="font-mono text-xs">{judged.next}</span>.
            </p>
            <p className="mt-1 text-xs text-violet-700">
              Confidence {judged.confidence.toFixed(2)} against a threshold of{' '}
              {judged.threshold.toFixed(2)}
              {judged.model === null ? '' : ` · ${judged.model}`}
            </p>
            {judged.rationale !== null && (
              <p className="mt-1 text-xs text-violet-700 italic">
                The model’s own account: “{judged.rationale}”
              </p>
            )}
          </div>
        )}

        {step.error !== null && (
          <p
            className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900"
            data-testid="step-error"
          >
            <span className="font-mono text-xs">{step.error.code}</span> — {step.error.message}
          </p>
        )}

        {details.length > 0 && (
          <dl className="mt-2 flex flex-col gap-0.5" data-testid="step-details">
            {details.map((row) => (
              <div className="flex flex-wrap items-baseline gap-2 text-sm" key={row.key}>
                <dt className="text-slate-500">{row.label}</dt>
                <dd className="font-medium text-slate-900">{row.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {events.length > 0 && (
          <ul className="mt-2 flex flex-col gap-0.5">
            {events.map((event) => (
              <EventLine event={event} key={event.id} testId="step-event-row" />
            ))}
          </ul>
        )}

        {evidence.length > 0 && (
          <div className="mt-3">
            <EvidenceGroup items={evidence} title="Evidence" />
          </div>
        )}

        {!hasBody && step.status === 'pending' && (
          <p className="mt-1 text-sm text-slate-500">Not reached.</p>
        )}
      </div>
    </li>
  );
}

/**
 * One event, in prose.
 *
 * `browser.navigation.completed` reads "navigation completed". The exact type
 * is still one click away in the raw stream, which is why softening it here
 * costs nothing.
 */
function EventLine({ event, testId }: { readonly event: RunEventView; readonly testId: string }) {
  const tone =
    event.eventType.endsWith('.failed') || event.eventType === 'assertion.failed'
      ? 'text-rose-700'
      : 'text-slate-600';

  return (
    <li className="flex items-baseline gap-2 text-sm" data-testid={testId}>
      <span aria-hidden="true" className="text-xs text-slate-300">
        ·
      </span>
      <span className={tone}>{humanizeEventType(event.eventType)}</span>
    </li>
  );
}
