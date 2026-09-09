import { useState, type FormEvent } from 'react';

import type { SopDraftInputView } from '@orbit/api/views';

import { ApiErrorNotice } from '../shared/ApiErrorNotice';
import { ApiRequestError, declareSopInput } from '../api-client';

export interface SopInputsPanelProps {
  readonly revisionId: string;
  readonly inputs: readonly SopDraftInputView[];
  readonly editable: boolean;
  /** Reloads the review after a successful declaration, as every other edit does. */
  readonly onSaved: () => void;
}

/**
 * Declaring the run inputs a workflow's steps may reference.
 *
 * The gap this closes: `${inputs.x}` is refused by the step editor unless `x`
 * is declared (ADR-007), and a recorded workflow starts with none at all --
 * every value a person typed while demonstrating a step was captured as a
 * literal. There was no way afterward to turn one into something a run
 * supplies. This is that path: name it here, then reference
 * `${inputs.<name>}` from a step's own value field.
 *
 * String-only, matching the only input type Agent IR's compiler carries
 * through to a run.
 */
export function SopInputsPanel({ revisionId, inputs, editable, onSaved }: SopInputsPanelProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [id, setId] = useState('');
  const [label, setLabel] = useState('');
  const [required, setRequired] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    declareSopInput(revisionId, { id, label, required })
      .then(() => {
        setIsAdding(false);
        setId('');
        setLabel('');
        setRequired(true);
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
      data-testid="sop-inputs"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Run inputs</h3>
        {editable && !isAdding && (
          <button
            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-900 transition-colors hover:border-slate-400"
            data-testid="sop-inputs-add"
            onClick={() => {
              setIsAdding(true);
            }}
            type="button"
          >
            Declare an input
          </button>
        )}
      </div>

      <p className="mt-1 text-xs text-slate-600">
        What a run supplies. Reference one from a step&apos;s value as{' '}
        <code className="font-mono">{'${inputs.<name>}'}</code>.
      </p>

      {inputs.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500" data-testid="sop-inputs-empty">
          No inputs declared yet.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1" data-testid="sop-inputs-list">
          {inputs.map((input) => (
            <li className="text-sm text-slate-900" key={input.id}>
              <code className="font-mono text-xs text-slate-600">
                ${'{inputs.'}
                {input.id}
                {'}'}
              </code>{' '}
              — {input.label}
              {input.required && <span className="ml-1 text-xs text-slate-500">(required)</span>}
            </li>
          ))}
        </ul>
      )}

      {error !== null && (
        <div className="mt-2">
          <ApiErrorNotice error={error} testId="sop-inputs-error" title="That did not work" />
        </div>
      )}

      {isAdding && (
        <form
          className="mt-3 rounded-md border border-indigo-300 bg-indigo-50/40 p-3"
          data-testid="sop-inputs-form"
          onSubmit={handleSubmit}
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-700" htmlFor="sop-input-id">
              Name (how a step references it, e.g. <code className="font-mono">memberId</code>)
            </label>
            <input
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
              data-testid="sop-input-id"
              id="sop-input-id"
              onChange={(event) => {
                setId(event.target.value);
              }}
              pattern="^[A-Za-z][A-Za-z0-9_]*$"
              required
              value={id}
            />
          </div>

          <div className="mt-3 flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-700" htmlFor="sop-input-label">
              Label (what a person sees when starting a run)
            </label>
            <input
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
              data-testid="sop-input-label"
              id="sop-input-label"
              onChange={(event) => {
                setLabel(event.target.value);
              }}
              required
              value={label}
            />
          </div>

          <label className="mt-3 flex items-center gap-2 text-xs text-slate-700">
            <input
              checked={required}
              onChange={(event) => {
                setRequired(event.target.checked);
              }}
              type="checkbox"
            />
            Required
          </label>

          <div className="mt-3 flex gap-2">
            <button
              className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
              data-testid="sop-inputs-save"
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
