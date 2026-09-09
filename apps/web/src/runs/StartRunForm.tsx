import { useState, type FormEvent } from 'react';

import type { AgentVersionView } from '@orbit/api/views';

export interface StartRunFormProps {
  readonly agentVersion: AgentVersionView | null;
  readonly isStarting: boolean;
  readonly onStart: (inputs: Readonly<Record<string, string>>) => void;
}

/**
 * The manual trigger.
 *
 * Every field is rendered from the Agent Version's own declared input schema —
 * genuinely, not just in name. An earlier version of this form said that in its
 * own comment while hard-coding a single field named `requestNumber`, which was
 * invisible as long as the seeded agent was the only one Watchtower could ever
 * show. Sub-phase 2.6 made other agents publishable and listed, and a form
 * that always sent `requestNumber` regardless of what an agent actually
 * declared started failing for every one of them — including a compiled,
 * recorded agent that declares no inputs at all, because 2.4f bakes every
 * typed value in as a literal rather than declaring it (a real, separate
 * limitation, stated in the report rather than solved here).
 */
export function StartRunForm({ agentVersion, isStarting, onStart }: StartRunFormProps) {
  const declarations = agentVersion?.inputSchema ?? {};
  const fields = Object.entries(declarations);

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map(([id, declaration]) => [id, declaration.examples?.[0] ?? ''])),
  );

  const disabled = agentVersion === null || isStarting;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (disabled) {
      return;
    }

    onStart(values);
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={handleSubmit}
      data-testid="start-run-form"
    >
      {fields.length === 0 ? (
        <p className="text-xs text-slate-500" data-testid="start-run-no-inputs">
          This agent takes no input — every run performs the same recorded steps.
        </p>
      ) : (
        fields.map(([id, declaration]) => (
          <div className="flex flex-col gap-1" key={id}>
            <label className="text-sm font-medium text-slate-900" htmlFor={`run-input-${id}`}>
              {declaration.label}
              {declaration.required ? '' : ' (optional)'}
            </label>
            <input
              autoComplete="off"
              className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100"
              data-testid={`input-field-${id}`}
              disabled={disabled}
              id={`run-input-${id}`}
              maxLength={declaration.validation?.maxLength ?? 200}
              name={id}
              onChange={(event) => {
                const { value } = event.target;
                setValues((current) => ({ ...current, [id]: value }));
              }}
              type="text"
              value={values[id] ?? ''}
            />
            {declaration.description !== undefined && (
              <p className="text-xs text-slate-500">{declaration.description}</p>
            )}
          </div>
        ))
      )}

      <button
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:bg-slate-300"
        data-testid="start-run-button"
        disabled={disabled}
        type="submit"
      >
        {isStarting ? 'Starting…' : 'Start run'}
      </button>
    </form>
  );
}
