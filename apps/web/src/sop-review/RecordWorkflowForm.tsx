import { useState, type FormEvent } from 'react';

import { LOCAL_BROWSER_NOTICE } from './recording-view-model';

export interface RecordWorkflowFormProps {
  readonly isStarting: boolean;
  readonly onStart: (title: string, startUrl: string) => void;
}

/**
 * Starting a recording.
 *
 * A title and a starting URL, because those are the two things a recording
 * cannot work out for itself: what the workflow is called, and where it begins.
 * Everything else comes from watching.
 */
export function RecordWorkflowForm({ isStarting, onStart }: RecordWorkflowFormProps) {
  const [title, setTitle] = useState('');
  const [startUrl, setStartUrl] = useState('http://localhost:3001/requests');

  const disabled = isStarting || title.trim() === '' || startUrl.trim() === '';

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!disabled) {
      onStart(title.trim(), startUrl.trim());
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      data-testid="record-workflow-form"
      onSubmit={handleSubmit}
    >
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-900" htmlFor="recording-title">
          What is this workflow called?
        </label>
        <input
          className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100"
          data-testid="recording-title"
          disabled={isStarting}
          id="recording-title"
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Find a service request"
          value={title}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-900" htmlFor="recording-url">
          Where does it start?
        </label>
        <input
          className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100"
          data-testid="recording-url"
          disabled={isStarting}
          id="recording-url"
          onChange={(event) => setStartUrl(event.target.value)}
          value={startUrl}
        />
      </div>

      <p className="text-xs text-amber-900" data-testid="recording-local-notice">
        {LOCAL_BROWSER_NOTICE}
      </p>

      <div>
        <button
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:bg-slate-300"
          data-testid="start-recording-button"
          disabled={disabled}
          type="submit"
        >
          {isStarting ? 'Opening the browser…' : 'Record a workflow'}
        </button>
      </div>
    </form>
  );
}
