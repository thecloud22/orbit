import { useState, type FormEvent } from 'react';

import type { SopDraftOutputView } from '@orbit/api/views';

import { ApiErrorNotice } from '../shared/ApiErrorNotice';
import { ApiRequestError, declareSopOutput } from '../api-client';

export interface SopOutputsPanelProps {
  readonly revisionId: string;
  readonly outputs: readonly SopDraftOutputView[];
  readonly editable: boolean;
  /** Reloads the review after a successful declaration, as every other edit does. */
  readonly onSaved: () => void;
}

/**
 * Declaring the run outputs a workflow's outcome steps may return.
 *
 * Symmetric to `SopInputsPanel`: an outcome step's `returns` names a variable
 * a step produces, but the compiler also requires that name to appear in the
 * graph's own `outputs` declaration -- it becomes `agentIr.outputs`, and
 * `complete.outputs` is checked against it there (`UNDECLARED_OUTPUT`). A
 * recorded or drafted workflow starts with no outputs declared at all; this
 * is the path to add one, then name it in an outcome step's `returns`.
 */
export function SopOutputsPanel({ revisionId, outputs, editable, onSaved }: SopOutputsPanelProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    declareSopOutput(revisionId, { name, label })
      .then(() => {
        setIsAdding(false);
        setName('');
        setLabel('');
        onSaved();
      })
      .catch((cause: unknown) => {
        setError(
          cause instanceof ApiRequestError
            ? cause
            : new ApiRequestError({ status: 0, message: 'The API could not be reached.' }),
        );
      })
      .finally(() => {
        setIsSaving(false);
      });
  }

  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
      data-testid="sop-outputs"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Run outputs</h3>
        {editable && !isAdding && (
          <button
            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-900 transition-colors hover:border-slate-400"
            data-testid="sop-outputs-add"
            onClick={() => {
              setIsAdding(true);
            }}
            type="button"
          >
            Declare an output
          </button>
        )}
      </div>

      <p className="mt-1 text-xs text-slate-600">
        What a run returns. Name one from an outcome step&apos;s{' '}
        <code className="font-mono">returns</code>.
      </p>

      {outputs.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500" data-testid="sop-outputs-empty">
          No outputs declared yet.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1" data-testid="sop-outputs-list">
          {outputs.map((output) => (
            <li className="text-sm text-slate-900" key={output.name}>
              <code className="font-mono text-xs text-slate-600">{output.name}</code> —{' '}
              {output.label}
            </li>
          ))}
        </ul>
      )}

      {error !== null && (
        <div className="mt-2">
          <ApiErrorNotice error={error} testId="sop-outputs-error" title="That did not work" />
        </div>
      )}

      {isAdding && (
        <form
          className="mt-3 rounded-md border border-indigo-300 bg-indigo-50/40 p-3"
          data-testid="sop-outputs-form"
          onSubmit={handleSubmit}
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-700" htmlFor="sop-output-name">
              Name (how an outcome returns it, e.g. <code className="font-mono">requestStatus</code>
              )
            </label>
            <input
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
              data-testid="sop-output-name"
              id="sop-output-name"
              onChange={(event) => {
                setName(event.target.value);
              }}
              pattern="^[A-Za-z][A-Za-z0-9_]*$"
              required
              value={name}
            />
          </div>

          <div className="mt-3 flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-700" htmlFor="sop-output-label">
              Label (what a person sees on a run's result)
            </label>
            <input
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
              data-testid="sop-output-label"
              id="sop-output-label"
              onChange={(event) => {
                setLabel(event.target.value);
              }}
              required
              value={label}
            />
          </div>

          <div className="mt-3 flex gap-2">
            <button
              className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
              data-testid="sop-outputs-save"
              disabled={isSaving}
              type="submit"
            >
              {isSaving ? 'Saving…' : 'Declare'}
            </button>
            <button
              className="rounded-md border border-slate-300 px-3 py-1 text-xs"
              onClick={() => {
                setIsAdding(false);
                setError(null);
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
