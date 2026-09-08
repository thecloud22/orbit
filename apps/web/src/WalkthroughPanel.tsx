import { useCallback, useEffect, useRef, useState } from 'react';

import type { WalkthroughSessionView } from '@orbit/api/views';

import {
  acceptRecoveryProposal,
  ApiRequestError,
  cancelWalkthrough,
  finishWalkthrough,
  getWalkthrough,
  dismissRecoveryProposal,
  setWalkthroughMode,
} from './api-client';
import { LOCAL_BROWSER_NOTICE, RECORDING_POLL_INTERVAL_MS } from './recording-view-model';
import {
  acceptableProposalIds,
  DECISION_NOTICE,
  describeWalkthroughFailure,
  phaseOf,
  summarizeWalkthrough,
  walkthroughRows,
  type ProposalTone,
  type WalkthroughFailure,
  type WalkthroughRow,
} from './walkthrough-view-model';

export interface WalkthroughPanelProps {
  readonly sessionId: string;
  readonly documentId: string;
  /** Called after anything that changes the document's bindings. */
  readonly onChanged: () => void;
  readonly onClosed: () => void;
  /** Sends one step to the existing per-step binding flow, unchanged. */
  readonly onBindStep: (stepId: string) => void;
}

const TONE_CLASSES: Readonly<Record<ProposalTone, string>> = {
  proposed: 'bg-sky-50 text-sky-900',
  accepted: 'bg-emerald-50 text-emerald-900',
  dismissed: 'bg-slate-100 text-slate-700',
  refused: 'bg-amber-50 text-amber-900',
};

/**
 * One walkthrough, and the review that follows it (ADR-035).
 *
 * Two halves in one panel, because they are one sitting from a person's point
 * of view: while the browser is open they see what has been captured as they
 * work, and the moment they finish, the same panel becomes the review — every
 * drafted step, what was proposed for it, and *for the steps that got nothing,
 * why*.
 *
 * The second half is the one that had to be got right. A screen showing six
 * matched steps and three silent blanks would read as "done", and the workflow
 * would fail to publish for reasons nobody was told. So a step with no proposal
 * is as loud as one with a proposal, and carries the button that sends it to
 * the per-step flow.
 */
export function WalkthroughPanel({
  sessionId,
  documentId,
  onChanged,
  onClosed,
  onBindStep,
}: WalkthroughPanelProps) {
  const [session, setSession] = useState<WalkthroughSessionView | null>(null);
  const [failure, setFailure] = useState<WalkthroughFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const stopped = useRef(false);

  const read = useCallback(async () => {
    try {
      const next = await getWalkthrough(sessionId);

      if (!stopped.current) {
        setSession(next);
      }

      return next;
    } catch (caught) {
      if (stopped.current) {
        return null;
      }

      const described = describeWalkthroughFailure(
        caught instanceof ApiRequestError
          ? caught
          : new ApiRequestError({ status: 0, message: 'The API could not be reached.' }),
      );

      // A session that has gone stops the poll; anything else is transient and
      // the next tick will say so.
      if (described.kind === 'gone') {
        stopped.current = true;
        setFailure(described);
      }

      return null;
    }
  }, [sessionId]);

  useEffect(() => {
    stopped.current = false;
    void read();

    const timer = setInterval(() => {
      if (!stopped.current) {
        void read();
      }
    }, RECORDING_POLL_INTERVAL_MS);

    return () => {
      stopped.current = true;
      clearInterval(timer);
    };
  }, [read]);

  // Polling is for watching captures arrive. Once the walkthrough has been
  // turned into proposals nothing changes on its own, and a request a second
  // for a screen somebody is reading would be spend for nothing.
  useEffect(() => {
    if (session !== null && phaseOf(session) === 'reviewing') {
      stopped.current = true;
    }
  }, [session]);

  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setFailure(null);

    try {
      await work();
      stopped.current = false;
      await read();
      stopped.current = session !== null && phaseOf(session) === 'reviewing';
      onChanged();
    } catch (caught) {
      setFailure(
        describeWalkthroughFailure(
          caught instanceof ApiRequestError
            ? caught
            : new ApiRequestError({ status: 0, message: 'The API could not be reached.' }),
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Accepting several, one call each.
   *
   * Deliberately not a bulk endpoint: each acceptance is independently valid or
   * refusable — a step somebody bound in another tab a moment ago must be
   * refused while the rest still go through — and one server-side loop would
   * have exactly these semantics with an extra route to keep honest. Every one
   * of these goes through the same accept path a single proposal does.
   */
  async function acceptAll(proposalIds: readonly string[]) {
    await act(async () => {
      for (const proposalId of proposalIds) {
        await acceptRecoveryProposal(documentId, proposalId);
      }
    });
  }

  if (failure !== null && failure.kind === 'gone' && session === null) {
    return (
      <Notice failure={failure}>
        <button
          className="mt-2 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium"
          data-testid="walkthrough-dismiss"
          onClick={onClosed}
          type="button"
        >
          Close this
        </button>
      </Notice>
    );
  }

  if (session === null) {
    return (
      <section
        className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
        data-testid="walkthrough-panel"
      >
        <p className="text-sm text-slate-600">Opening the walkthrough…</p>
      </section>
    );
  }

  const summary = summarizeWalkthrough(session);
  const rows = walkthroughRows(session);
  const outstanding = acceptableProposalIds(session);

  return (
    <section
      className="rounded-lg border border-indigo-200 bg-white p-5 shadow-sm"
      data-testid="walkthrough-panel"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">
          {phaseOf(session) === 'demonstrating'
            ? 'Walking through the whole workflow'
            : 'What Orbit made of your walkthrough'}
        </h3>
        <span className="text-xs text-slate-500" data-testid="walkthrough-phase">
          {session.browserOpen ? 'Browser open' : 'Browser closed'}
        </span>
      </div>

      <p className="mt-1 text-sm text-slate-700" data-testid="walkthrough-summary">
        {summary.headline}
      </p>

      {summary.detail !== null && (
        <p className="mt-1 text-xs text-slate-600" data-testid="walkthrough-summary-detail">
          {summary.detail}
        </p>
      )}

      {failure !== null && <Notice failure={failure} />}

      {phaseOf(session) === 'demonstrating' ? (
        <Demonstrating
          busy={busy}
          onCancel={() =>
            void act(async () => {
              await cancelWalkthrough(sessionId);
              onClosed();
            })
          }
          onFinish={() => void act(() => finishWalkthrough(sessionId))}
          onMode={(mode) => void act(() => setWalkthroughMode(sessionId, mode))}
          session={session}
        />
      ) : (
        <Reviewing
          busy={busy}
          onAcceptAll={() => void acceptAll(outstanding)}
          onAccept={(proposalId) => void act(() => acceptRecoveryProposal(documentId, proposalId))}
          onBindStep={onBindStep}
          onDismiss={(proposalId) =>
            void act(() => dismissRecoveryProposal(documentId, proposalId))
          }
          onDone={onClosed}
          outstanding={outstanding}
          rows={rows}
        />
      )}
    </section>
  );
}

/** The half where a person is doing the task in the other window. */
function Demonstrating({
  session,
  onMode,
  onFinish,
  onCancel,
  busy,
}: {
  readonly session: WalkthroughSessionView;
  readonly onMode: (mode: 'action' | 'pick') => void;
  readonly onFinish: () => void;
  readonly onCancel: () => void;
  readonly busy: boolean;
}) {
  return (
    <>
      <p className="mt-2 text-xs text-slate-500">{LOCAL_BROWSER_NOTICE}</p>

      {/*
        The one control that is not just "do the task". A step that *reads* a
        value is demonstrated by pointing at it, and pointing must not fire the
        page's own handlers — so it is a mode, and the person is told which one
        they are in rather than left to guess why their click did nothing.
      */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ModeButton
          busy={busy}
          current={session.mode}
          label="Performing the task"
          mode="action"
          onMode={onMode}
        />
        <ModeButton
          busy={busy}
          current={session.mode}
          label="Pointing at a value to read"
          mode="pick"
          onMode={onMode}
        />
      </div>

      <p className="mt-1 text-xs text-slate-500">
        {session.mode === 'action'
          ? 'Clicks and typing go to the page exactly as they normally would.'
          : 'Clicking marks an element to be read. The page will not react.'}
      </p>

      <ol className="mt-3 flex flex-col gap-1" data-testid="walkthrough-captures">
        {session.captures.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing captured yet.</p>
        ) : (
          session.captures.map((capture) => (
            <li
              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700"
              data-testid="walkthrough-capture"
              key={capture.order}
            >
              <span className="mr-2 font-mono text-slate-400">{capture.order}</span>
              {capture.description}
            </li>
          ))
        )}
      </ol>

      {session.failures.length > 0 && (
        <ul
          className="mt-2 list-disc pl-5 text-xs text-amber-900"
          data-testid="walkthrough-failures"
        >
          {session.failures.map((entry) => (
            <li key={`${entry.url}:${entry.reason}`}>{entry.reason}</li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:bg-slate-300"
          data-testid="walkthrough-finish"
          disabled={busy}
          onClick={onFinish}
          type="button"
        >
          {busy ? 'Working…' : 'Finish and review what Orbit matched'}
        </button>
        <button
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 disabled:text-slate-400"
          data-testid="walkthrough-cancel"
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      </div>
    </>
  );
}

function ModeButton({
  mode,
  current,
  label,
  onMode,
  busy,
}: {
  readonly mode: 'action' | 'pick';
  readonly current: string;
  readonly label: string;
  readonly onMode: (mode: 'action' | 'pick') => void;
  readonly busy: boolean;
}) {
  const selected = current === mode;

  return (
    <button
      aria-pressed={selected}
      className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:text-slate-400 ${
        selected
          ? 'border-indigo-400 bg-indigo-50 text-indigo-800'
          : 'border-slate-300 text-slate-700 hover:border-slate-400'
      }`}
      data-testid={`walkthrough-mode-${mode}`}
      disabled={busy}
      onClick={() => onMode(mode)}
      type="button"
    >
      {label}
    </button>
  );
}

/** The review: every drafted step, and what the walkthrough had to say about it. */
function Reviewing({
  rows,
  outstanding,
  onAccept,
  onAcceptAll,
  onDismiss,
  onBindStep,
  onDone,
  busy,
}: {
  readonly rows: readonly WalkthroughRow[];
  readonly outstanding: readonly string[];
  readonly onAccept: (proposalId: string) => void;
  readonly onAcceptAll: () => void;
  readonly onDismiss: (proposalId: string) => void;
  readonly onBindStep: (stepId: string) => void;
  readonly onDone: () => void;
  readonly busy: boolean;
}) {
  return (
    <>
      <p className="mt-2 text-xs text-slate-600">
        Nothing here is live yet. Accepting one records it as this step&rsquo;s approved mapping,
        through exactly the path a step demonstrated on its own goes through.
      </p>

      {outstanding.length > 0 && (
        <div className="mt-3">
          <button
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:bg-slate-300"
            data-testid="walkthrough-accept-all"
            disabled={busy}
            onClick={onAcceptAll}
            type="button"
          >
            {busy ? 'Working…' : `Accept all ${String(outstanding.length)}`}
          </button>
        </div>
      )}

      <ul className="mt-3 flex flex-col gap-2" data-testid="walkthrough-steps">
        {rows.map((row) => (
          <li
            className="rounded-md border border-slate-200 p-3"
            data-testid="walkthrough-step"
            key={row.stepId}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-sm text-slate-900">
                <span className="mr-2 font-mono text-xs text-slate-500">{row.kind}</span>
                <span data-testid="walkthrough-step-label">{row.label}</span>
              </p>
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[row.tone]}`}
                data-testid={`walkthrough-status-${row.stepId}`}
              >
                {row.statusLabel}
              </span>
            </div>

            <p className="mt-1 text-xs text-slate-600" data-testid="walkthrough-step-detail">
              {row.detail}
            </p>

            <div className="mt-2 flex flex-wrap gap-2">
              {row.acceptable && row.proposalId !== null && (
                <>
                  <button
                    className="rounded-md border border-indigo-400 px-2 py-1 text-xs font-medium text-indigo-800 transition-colors hover:border-indigo-500 disabled:text-slate-400"
                    data-testid={`walkthrough-accept-${row.stepId}`}
                    disabled={busy}
                    onClick={() => onAccept(row.proposalId as string)}
                    type="button"
                  >
                    Accept
                  </button>
                  <button
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-slate-400 disabled:text-slate-400"
                    data-testid={`walkthrough-dismiss-${row.stepId}`}
                    disabled={busy}
                    onClick={() => onDismiss(row.proposalId as string)}
                    type="button"
                  >
                    Wrong — dismiss
                  </button>
                </>
              )}

              {row.needsDemonstration && (
                <button
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-900 transition-colors hover:border-slate-400 disabled:text-slate-400"
                  data-testid={`walkthrough-bind-${row.stepId}`}
                  disabled={busy}
                  onClick={() => onBindStep(row.stepId)}
                  type="button"
                >
                  Demonstrate this step on its own
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/*
        Said where a person will see it, not only in a document. Somebody who is
        not told this reads a decision's blank row as Orbit having failed.
      */}
      <p
        className="mt-3 rounded bg-slate-50 px-3 py-2 text-xs text-slate-600"
        data-testid="walkthrough-decision-notice"
      >
        {DECISION_NOTICE}
      </p>

      <div className="mt-3">
        <button
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400"
          data-testid="walkthrough-done"
          onClick={onDone}
          type="button"
        >
          Done with this walkthrough
        </button>
      </div>
    </>
  );
}

function Notice({
  failure,
  children,
}: {
  readonly failure: WalkthroughFailure;
  readonly children?: React.ReactNode;
}) {
  return (
    <section
      className="mt-3 rounded border border-rose-300 bg-rose-50 p-3"
      data-testid="walkthrough-failure"
    >
      <h4 className="text-sm font-semibold text-rose-900">{failure.title}</h4>
      <p className="mt-1 text-sm text-rose-900">{failure.message}</p>
      {children}
    </section>
  );
}
