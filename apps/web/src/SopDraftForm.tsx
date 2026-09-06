import { useState, type FormEvent } from 'react';

export interface SopDraftFormProps {
  readonly isGenerating: boolean;
  readonly onGenerate: (sourceText: string) => void;
}

/**
 * The free-text SOP input surface (sub-phase 2.2).
 *
 * A textarea and a button, deliberately. There is no step editor, no reorder
 * control, and no JSON editor here — those belong to the review UI in sub-phase
 * 2.3, and shipping half of one now would set an expectation this phase cannot
 * meet.
 */
export function SopDraftForm({ isGenerating, onGenerate }: SopDraftFormProps) {
  const [sourceText, setSourceText] = useState('');
  const trimmed = sourceText.trim();
  const disabled = isGenerating || trimmed.length === 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!disabled) {
      onGenerate(trimmed);
    }
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={handleSubmit} data-testid="sop-draft-form">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-900" htmlFor="sop-source-text">
          Describe the procedure in your own words
        </label>
        <textarea
          className="min-h-40 rounded border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100"
          data-testid="sop-source-text"
          disabled={isGenerating}
          id="sop-source-text"
          name="sourceText"
          onChange={(event) => setSourceText(event.target.value)}
          placeholder="Go to the service request portal and sign in. Search for the request number and open the matching request…"
          value={sourceText}
        />
        <p className="text-xs text-slate-500">
          Orbit turns this into a reviewable draft. It does not open any website you mention.
        </p>
      </div>

      <div>
        <button
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:bg-slate-400"
          data-testid="generate-draft-button"
          disabled={disabled}
          type="submit"
        >
          {isGenerating ? 'Generating…' : 'Generate draft'}
        </button>
      </div>
    </form>
  );
}
