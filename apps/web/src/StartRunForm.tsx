import { useState, type FormEvent } from 'react';

import type { AgentVersionView } from '@orbit/api/views';

export interface StartRunFormProps {
  readonly agentVersion: AgentVersionView | null;
  readonly isStarting: boolean;
  readonly onStart: (requestNumber: string) => void;
}

/**
 * The manual trigger.
 *
 * The field is rendered from the Agent Version's own declared input schema
 * rather than hard-coded, so the form is generated from the contract the run
 * will actually be validated against.
 */
export function StartRunForm({ agentVersion, isStarting, onStart }: StartRunFormProps) {
  const [requestNumber, setRequestNumber] = useState('SR-1001');

  const declaration = agentVersion?.inputSchema['requestNumber'];
  const disabled = agentVersion === null || isStarting;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (disabled) {
      return;
    }

    onStart(requestNumber);
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={handleSubmit}
      data-testid="start-run-form"
    >
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-900" htmlFor="request-number">
          {declaration?.label ?? 'Service request number'}
        </label>
        <input
          autoComplete="off"
          className="w-64 rounded border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100"
          data-testid="request-number-field"
          disabled={disabled}
          id="request-number"
          maxLength={declaration?.validation?.maxLength ?? 100}
          name="requestNumber"
          onChange={(event) => setRequestNumber(event.target.value)}
          type="text"
          value={requestNumber}
        />
      </div>

      <button
        className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:bg-slate-400"
        data-testid="start-run-button"
        disabled={disabled}
        type="submit"
      >
        {isStarting ? 'Starting…' : 'Start run'}
      </button>

      {declaration?.description !== undefined && (
        <p className="w-full text-xs text-slate-500">{declaration.description}</p>
      )}
    </form>
  );
}
