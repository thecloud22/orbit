import { useCallback, useEffect, useRef, useState } from 'react';

import type { BindingSessionView } from '@orbit/api/views';

import {
  ApiRequestError,
  cancelBindingSession,
  getBindingSession,
  saveBinding,
} from './api-client';
import {
  bindDisabledReason,
  branchProgress,
  captureInstruction,
  captureRows,
  describeBindingSessionFailure,
  formFieldsFor,
  multiFieldWarning,
  nextBranch,
  saveButtonLabel,
  type BindingFailure,
} from './binding-session-view-model';
import { LOCAL_BROWSER_NOTICE, RECORDING_POLL_INTERVAL_MS } from './recording-view-model';

export interface BindingSessionPanelProps {
  readonly sessionId: string;
  /** Called after a binding is saved, so the review page reloads its status. */
  readonly onSaved: () => void;
  readonly onClosed: () => void;
}

/**
 * Binding one step against a real page, inline on the review page.
 *
 * Live but non-blocking, the same shape the recording panel uses: the captures
 * fill in as the person works in the other window, and nothing here interrupts
 * them.
 *
 * The confirm form asks only what a capture cannot answer. A drafted fill step
 * already declares where its value comes from, so that is stated rather than
 * asked — confirming a drafted step, not re-authoring it. What a person still
 * chooses is which capture was the step, and, for a step that reads several
 * values, which one this binding reads.
 */
export function BindingSessionPanel({ sessionId, onSaved, onClosed }: BindingSessionPanelProps) {
  const [session, setSession] = useState<BindingSessionView | null>(null);
  const [failure, setFailure] = useState<BindingFailure | null>(null);
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null);
  const [variable, setVariable] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedStepId, setSavedStepId] = useState<string | null>(null);
  const stopped = useRef(false);

  const poll = useCallback(async () => {
    try {
      const next = await getBindingSession(sessionId);
      if (!stopped.current) {
        setSession(next);
      }
    } catch (caught) {
      if (stopped.current) {
        return;
      }

      const described = describeBindingSessionFailure(
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

  // A capture that has gone (the session cleared them after a save) must not
  // stay selected, or the next save would name a capture the server forgot.
  useEffect(() => {
    if (
      selectedCaptureId !== null &&
      session !== null &&
      !session.captures.some((capture) => capture.captureId === selectedCaptureId)
    ) {
      setSelectedCaptureId(null);
    }
  }, [session, selectedCaptureId]);

  async function save() {
    if (selectedCaptureId === null) {
      return;
    }

    setIsSaving(true);
    setFailure(null);

    try {
      const branch = session === null ? null : nextBranch(session.step);

      const saved = await saveBinding(sessionId, {
        captureId: selectedCaptureId,
        ...(variable === null || variable === '' ? {} : { variable }),
        ...(branch === null ? {} : { branchWhen: branch.when }),
      });

      setSession(saved.session);
      // Null when a decision branch was captured and others remain: nothing was
      // written, so the panel must not claim a binding was saved.
      setSavedStepId(saved.bindingId === null ? null : saved.stepId);
      setSelectedCaptureId(null);
      setVariable(null);

      if (saved.bindingId !== null) {
        onSaved();
      }
    } catch (caught) {
      setFailure(
        describeBindingSessionFailure(
          caught instanceof ApiRequestError
            ? caught
            : new ApiRequestError({ status: 0, message: 'The API could not be reached.' }),
        ),
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function done() {
    stopped.current = true;

    try {
      await cancelBindingSession(sessionId);
    } catch {
      // The session may already be gone; either way this view is done with it.
    }

    onClosed();
  }

  const rows = captureRows(session);
  const fields = session === null ? null : formFieldsFor(session.step);
  const warning = session === null ? null : multiFieldWarning(session.step);
  const disabledReason = bindDisabledReason({ session, selectedCaptureId, variable });
  const branch = session === null ? null : nextBranch(session.step);
  const progress = session === null ? null : branchProgress(session.step);

  return (
    <section
      className="rounded-lg border border-indigo-200 bg-white p-5 shadow-sm"
      data-testid="binding-session"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900" data-testid="binding-session-step">
          Binding: {session === null ? 'opening a browser…' : session.step.summary}
        </h3>
        <button
          className="rounded-md border border-slate-300 px-3 py-1 text-sm"
          data-testid="binding-session-done"
          onClick={() => void done()}
          type="button"
        >
          Done
        </button>
      </div>

      <p className="mt-1 text-xs text-slate-600">{LOCAL_BROWSER_NOTICE}</p>
      {session !== null && (
        <p className="mt-1 text-xs text-slate-500" data-testid="binding-session-url">
          Currently at {session.currentUrl}
        </p>
      )}

      {savedStepId !== null && (
        <p
          className="mt-2 rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-900"
          data-testid="binding-saved"
        >
          Saved and approved. The browser is still open — bind another step by choosing one below,
          or click Done.
        </p>
      )}

      {progress !== null && (
        <p
          className="mt-2 rounded bg-slate-50 px-3 py-2 text-xs text-slate-700"
          data-testid="binding-branch-progress"
        >
          {progress}
        </p>
      )}

      {branch !== null && (
        <p
          className="mt-2 rounded bg-indigo-50 px-3 py-2 text-xs text-indigo-900"
          data-testid="binding-branch-prompt"
        >
          Branch {branch.position} of {branch.total}: <strong>{branch.when}</strong>
        </p>
      )}

      {warning !== null && (
        <p
          className="mt-2 rounded bg-amber-50 px-3 py-2 text-xs text-amber-900"
          data-testid="binding-multi-field-warning"
        >
          {warning}
        </p>
      )}

      {failure !== null && (
        <section
          className="mt-3 rounded border border-rose-300 bg-rose-50 p-3"
          data-testid="binding-failure"
        >
          <h4 className="text-sm font-semibold text-rose-900" data-testid="binding-failure-title">
            {failure.title}
          </h4>
          <p className="mt-1 text-sm text-rose-900">{failure.message}</p>
          {failure.issues.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-rose-900">
              {failure.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
          {failure.sessionSurvived && (
            <p className="mt-2 text-xs text-rose-900" data-testid="binding-survived">
              The browser is still open. Nothing was lost.
            </p>
          )}
        </section>
      )}

      {fields !== null && fields.declaredValue !== null && (
        <p className="mt-2 text-xs text-slate-600" data-testid="binding-declared-value">
          {fields.sensitive
            ? 'This field is a password. Nothing you type is read or stored; the binding records only which field it is.'
            : `This step fills the field with ${fields.declaredValue}.`}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600" data-testid="binding-empty">
          {captureInstruction(session)}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1" data-testid="binding-captures">
          {rows.map((row) => (
            <li key={row.captureId}>
              <label className="flex items-center gap-2 text-sm text-slate-800">
                <input
                  checked={selectedCaptureId === row.captureId}
                  data-testid={`binding-capture-${row.captureId}`}
                  name="binding-capture"
                  onChange={() => setSelectedCaptureId(row.captureId)}
                  type="radio"
                />
                <span className="font-mono text-xs text-slate-500">{row.kind}</span>
                <span>{row.label}</span>
                {row.sensitive && (
                  <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-900">
                    value not read
                  </span>
                )}
              </label>
            </li>
          ))}
        </ul>
      )}

      {fields !== null && fields.needsVariableChoice && (
        <label className="mt-3 flex flex-col gap-1 text-sm text-slate-800">
          <span>Which value does this read?</span>
          <select
            className="w-fit rounded-md border border-slate-300 px-2 py-1 text-sm"
            data-testid="binding-variable"
            onChange={(event) => setVariable(event.target.value === '' ? null : event.target.value)}
            value={variable ?? ''}
          >
            <option value="">Choose a value…</option>
            {fields.variableOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      )}

      {session !== null && session.failures.length > 0 && (
        <ul
          className="mt-3 list-disc pl-5 text-xs text-amber-900"
          data-testid="binding-failed-captures"
        >
          {session.failures.map((entry) => (
            <li key={`${entry.url}:${entry.reason}`}>{entry.reason}</li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:bg-slate-300"
          data-testid="save-binding-button"
          disabled={isSaving || disabledReason !== null}
          onClick={() => void save()}
          type="button"
        >
          {isSaving ? 'Saving…' : saveButtonLabel(session)}
        </button>
        {disabledReason !== null && (
          <span className="text-xs text-slate-500" data-testid="binding-disabled-reason">
            {disabledReason}
          </span>
        )}
      </div>
    </section>
  );
}
