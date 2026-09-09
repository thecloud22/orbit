import { useState, type FormEvent } from 'react';

import type { ModelSpendSummary } from './sop-draft-view-model';

export interface SopDraftFormProps {
  readonly isGenerating: boolean;
  readonly onGenerate: (sourceText: string) => void;
  /**
   * Model spend and headroom, or null while it is still loading.
   *
   * The button reflects it, and that is all it does. The **server** is the gate
   * (ADR-029): a Generate that would exceed a ceiling is refused before any call
   * is made, whether or not this component ever rendered. Disabling the button
   * is a courtesy so nobody writes three paragraphs first.
   */
  readonly spend?: ModelSpendSummary | null;
}

/**
 * The free-text SOP input surface (sub-phase 2.2).
 *
 * A textarea and a button, deliberately. There is no step editor, no reorder
 * control, and no JSON editor here — those belong to the review UI in sub-phase
 * 2.3, and shipping half of one now would set an expectation this phase cannot
 * meet.
 */
export function SopDraftForm({ isGenerating, onGenerate, spend }: SopDraftFormProps) {
  const [sourceText, setSourceText] = useState('');
  const trimmed = sourceText.trim();
  const blocked = spend?.exhausted === true;
  const disabled = isGenerating || trimmed.length === 0 || blocked;

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
          className="min-h-40 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100"
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

      {spend != null && (
        <section
          className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
          data-testid="model-spend"
        >
          <p className="text-xs text-slate-700">
            Model use so far: <strong data-testid="model-spend-used">{spend.usedLabel}</strong>,
            costing about <span data-testid="model-spend-cost">{spend.costLabel}</span>. Cost is an
            estimate from configured rates, not a bill.
          </p>
          <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">
            {spend.remainingLabels.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
          {spend.blockedReason !== null && (
            <p className="mt-2 text-xs font-medium text-rose-800" data-testid="model-spend-blocked">
              {spend.blockedReason}
            </p>
          )}
        </section>
      )}

      <div>
        <button
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:bg-slate-300"
          data-testid="generate-draft-button"
          disabled={disabled}
          type="submit"
        >
          {isGenerating ? 'Generating…' : blocked ? 'Budget used up' : 'Generate draft'}
        </button>
      </div>
    </form>
  );
}
