import { useCallback, useEffect, useRef, useState } from 'react';

import type { RecordingSessionView } from '@orbit/api/views';

import {
  ApiRequestError,
  cancelRecording,
  finishRecording,
  getRecordingSession,
} from './api-client';
import type { View } from './navigation';
import {
  canFinish,
  describeRecordingFailure,
  LOCAL_BROWSER_NOTICE,
  RECORDING_EMPTY_MESSAGE,
  RECORDING_POLL_INTERVAL_MS,
  recordedRows,
  type RecordingFailure,
} from './recording-view-model';

export interface RecordingSessionPageProps {
  readonly sessionId: string;
  readonly onFinished: (view: View) => void;
  readonly onCancelled: () => void;
}

/**
 * A recording in progress.
 *
 * Live but non-blocking: the list fills in as the person works in the other
 * window, and nothing here interrupts them. Watchtower is the place they come
 * back to when they are done, not something they have to attend to while
 * recording.
 */
export function RecordingSessionPage({
  sessionId,
  onFinished,
  onCancelled,
}: RecordingSessionPageProps) {
  const [session, setSession] = useState<RecordingSessionView | null>(null);
  const [failure, setFailure] = useState<RecordingFailure | null>(null);
  const [isFinishing, setIsFinishing] = useState(false);
  const stopped = useRef(false);

  const poll = useCallback(async () => {
    try {
      const next = await getRecordingSession(sessionId);
      if (!stopped.current) {
        setSession(next);
      }
    } catch (caught) {
      if (stopped.current) {
        return;
      }

      const described = describeRecordingFailure(
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
    }
  }, [sessionId]);

  useEffect(() => {
    stopped.current = false;
    void poll();

    const timer = setInterval(() => {
      if (!stopped.current) {
        void poll();
      }
    }, RECORDING_POLL_INTERVAL_MS);

    return () => {
      stopped.current = true;
      clearInterval(timer);
    };
  }, [poll]);

  async function finish() {
    setIsFinishing(true);
    setFailure(null);

    try {
      const finished = await finishRecording(sessionId);
      stopped.current = true;
      onFinished({ kind: 'review', documentId: finished.documentId });
    } catch (caught) {
      setFailure(
        describeRecordingFailure(
          caught instanceof ApiRequestError
            ? caught
            : new ApiRequestError({ status: 0, message: 'The API could not be reached.' }),
        ),
      );
    } finally {
      setIsFinishing(false);
    }
  }

  async function discard() {
    stopped.current = true;

    try {
      await cancelRecording(sessionId);
    } catch {
      // The session may already be gone; either way this view is done with it.
    }

    onCancelled();
  }

  const rows = recordedRows(session);

  return (
    <section className="flex flex-col gap-4" data-testid="recording-session">
      <header className="rounded border border-slate-200 p-4">
        <h2
          className="text-base font-semibold text-slate-900"
          data-testid="recording-session-title"
        >
          Recording{session === null ? '' : `: ${session.title}`}
        </h2>
        <p className="mt-1 text-xs text-slate-600">{LOCAL_BROWSER_NOTICE}</p>
        {session !== null && (
          <p className="mt-1 text-xs text-slate-500" data-testid="recording-current-url">
            Currently at {session.currentUrl}
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:bg-slate-300"
            data-testid="finish-recording-button"
            disabled={isFinishing || !canFinish(session)}
            onClick={() => void finish()}
            type="button"
          >
            {isFinishing ? 'Saving…' : 'Finish recording'}
          </button>
          <button
            className="rounded border border-slate-300 px-3 py-1.5 text-sm"
            data-testid="discard-recording-button"
            onClick={() => void discard()}
            type="button"
          >
            Discard
          </button>
        </div>
      </header>

      {failure !== null && (
        <section
          className="rounded border border-rose-300 bg-rose-50 p-4"
          data-testid="recording-failure"
        >
          <h3 className="text-sm font-semibold text-rose-900" data-testid="recording-failure-title">
            {failure.title}
          </h3>
          <p className="mt-1 text-sm text-rose-900">{failure.message}</p>
          {failure.issues.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-rose-900">
              {failure.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
          {failure.sessionSurvived && (
            // A recording cannot be repeated from memory, so this is the most
            // important sentence on the page when something goes wrong.
            <p className="mt-2 text-xs text-rose-900" data-testid="recording-survived">
              Your recording is still open. Nothing was lost.
            </p>
          )}
        </section>
      )}

      <section className="rounded border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-900">What you have done so far</h3>

        {rows.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600" data-testid="recording-empty">
            {RECORDING_EMPTY_MESSAGE}
          </p>
        ) : (
          <ol className="mt-2 flex flex-col gap-1" data-testid="recording-actions">
            {rows.map((row) => (
              <li className="text-sm text-slate-800" data-testid="recording-action" key={row.order}>
                <span className="mr-2 text-xs text-slate-500">{row.order}.</span>
                <span className="mr-2 font-mono text-xs text-slate-500">{row.detail}</span>
                {row.label}
                {row.sensitive && (
                  <span className="ml-2 rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-900">
                    value not read
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}
