import { useState } from 'react';

import type { SopReviewStepView } from '@orbit/api/views';

import { ApiRequestError, draftRule, insertSopStep } from '../api-client';
import { describeProposedRule, workflowRules, type WorkflowRule } from './sop-review-view-model';

const RESOLUTION_LABELS: Readonly<Record<WorkflowRule['resolution'], string>> = {
  computed: 'Compared',
  judged: 'Judged by a model',
  demonstrated: 'Read from the page',
};

const RESOLUTION_TONES: Readonly<Record<WorkflowRule['resolution'], string>> = {
  computed: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  judged: 'bg-amber-50 text-amber-800 border-amber-200',
  demonstrated: 'bg-slate-100 text-slate-700 border-slate-200',
};

/**
 * The business rules this workflow carries, read as rules rather than as steps.
 *
 * The same decisions the step list already shows, presented the way the person
 * who wrote them thinks about them: the sentence first, then what the workflow
 * actually does about it. That pairing is the point — a rule and the comparison
 * claiming to implement it sit on the same card, so a threshold edited away
 * from its own sentence is visible rather than buried in a step form.
 *
 * It is a view, not a store. There is no rules table and no rule id: a rule is
 * a decision step, and a second list would be free to disagree with the
 * workflow it describes.
 */
export function SopRulesPanel({
  steps,
  documentId,
  revisionId,
  editable,
  onAdded,
}: {
  readonly steps: readonly SopReviewStepView[];
  readonly documentId: string;
  readonly revisionId: string;
  readonly editable: boolean;
  readonly onAdded: () => void;
}) {
  const rules = workflowRules(steps);
  const modelCalls = rules.filter((rule) => rule.resolution === 'judged').length;

  if (rules.length === 0 && !editable) {
    return null;
  }

  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
      data-testid="sop-rules-panel"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Business rules</h3>
        <p className="text-xs text-slate-500">
          {rules.length === 1 ? '1 decision' : `${String(rules.length)} decisions`}
          {modelCalls === 0
            ? ' · none of them asks a model'
            : modelCalls === 1
              ? ' · one of them asks a model'
              : ` · ${String(modelCalls)} of them ask a model`}
        </p>
      </div>

      {editable && <RuleWriter documentId={documentId} onAdded={onAdded} revisionId={revisionId} />}

      <ul className="mt-3 flex flex-col gap-2">
        {rules.map((rule) => (
          <li
            className="rounded-md border border-slate-200 p-3"
            data-testid={`sop-rule-${rule.stepId}`}
            key={rule.stepId}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-sm text-slate-900">
                <span className="mr-2 text-xs text-slate-500">{rule.position}.</span>
                {rule.ruleText ?? rule.question}
              </p>
              <span
                className={`rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${RESOLUTION_TONES[rule.resolution]}`}
              >
                {RESOLUTION_LABELS[rule.resolution]}
              </span>
            </div>

            {rule.comparison !== null && (
              <p
                className="mt-1.5 font-mono text-xs text-slate-600"
                data-testid={`sop-rule-comparison-${rule.stepId}`}
              >
                {rule.comparison}
              </p>
            )}

            {/* Shown only when a sentence was written, since otherwise the
                question is already the headline above and repeating it would
                pad every card in an unannotated workflow. */}
            {rule.ruleText !== null && (
              <p className="mt-1.5 text-xs text-slate-500">{rule.question}</p>
            )}

            <ul className="mt-2 flex flex-col gap-0.5">
              {rule.branches.map((branch) => (
                <li className="text-xs text-slate-500" key={`${branch.when}-${branch.nextStepId}`}>
                  {branch.when} →{' '}
                  {branch.nextStepSummary === null ? (
                    // No such step. Shown as the bare id, because a dangling
                    // branch is a real problem and reading like one is the point.
                    <span className="font-mono text-rose-700">{branch.nextStepId}</span>
                  ) : (
                    <span className="text-slate-700">{branch.nextStepSummary}</span>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

type WriterState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'drafting' }
  | {
      readonly kind: 'proposed';
      readonly step: Record<string, unknown>;
      readonly insertAfterStepId: string;
      readonly insertAtIndex: number;
    }
  | { readonly kind: 'adding' }
  | { readonly kind: 'refused'; readonly message: string; readonly reasons: readonly string[] };

/**
 * Writing a rule in words, and reading back what Orbit proposes to do about it.
 *
 * Two steps rather than one, deliberately. The model's answer is *shown* — the
 * comparison it chose, where each branch goes, where the step would sit — and
 * adding it is a second, separate click. Every generated thing in Orbit is
 * reviewed before it becomes part of a workflow, and a rule that silently
 * rewrote a lending procedure would be the one exception nobody asked for.
 *
 * The refusal path matters as much as the happy one. "No step in this workflow
 * reads that value" is the common answer for a rule about a figure nobody
 * records, and the fix is to record it — so the reasons are shown in full
 * rather than collapsed into "could not draft that".
 */
function RuleWriter({
  documentId,
  revisionId,
  onAdded,
}: {
  readonly documentId: string;
  readonly revisionId: string;
  readonly onAdded: () => void;
}) {
  const [ruleText, setRuleText] = useState('');
  const [state, setState] = useState<WriterState>({ kind: 'idle' });

  async function propose() {
    const text = ruleText.trim();

    if (text === '') {
      return;
    }

    setState({ kind: 'drafting' });

    try {
      const result = await draftRule(documentId, text);
      setState({ kind: 'proposed', ...result });
    } catch (caught) {
      setState({
        kind: 'refused',
        message:
          caught instanceof ApiRequestError
            ? caught.message
            : 'Orbit could not reach the model to draft this rule.',
        reasons:
          caught instanceof ApiRequestError ? caught.details.map((detail) => detail.message) : [],
      });
    }
  }

  async function add(step: Record<string, unknown>, index: number) {
    setState({ kind: 'adding' });

    try {
      await insertSopStep(revisionId, index, step, `Rule: ${ruleText.trim()}`);
      setRuleText('');
      setState({ kind: 'idle' });
      onAdded();
    } catch (caught) {
      setState({
        kind: 'refused',
        message:
          caught instanceof ApiRequestError
            ? caught.message
            : 'The step could not be added to this workflow.',
        reasons:
          caught instanceof ApiRequestError ? caught.details.map((detail) => detail.message) : [],
      });
    }
  }

  const busy = state.kind === 'drafting' || state.kind === 'adding';

  return (
    <div className="mt-3 rounded-md border border-dashed border-slate-300 bg-slate-50 p-3">
      <label className="text-xs font-medium text-slate-700" htmlFor="rule-text">
        Write a rule in your own words
      </label>
      <div className="mt-1 flex flex-wrap gap-2">
        <input
          className="min-w-72 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          data-testid="rule-text"
          disabled={busy}
          id="rule-text"
          onChange={(event) => {
            setRuleText(event.target.value);
            setState({ kind: 'idle' });
          }}
          placeholder="If debt-to-income is over 43%, refer the file to a senior underwriter"
          value={ruleText}
        />
        <button
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:bg-slate-300"
          data-testid="rule-draft"
          disabled={busy || ruleText.trim() === ''}
          onClick={() => void propose()}
          type="button"
        >
          {state.kind === 'drafting' ? 'Reading the workflow…' : 'Draft this rule'}
        </button>
      </div>
      <p className="mt-1.5 text-xs text-slate-500">
        Orbit proposes a step; it is added only when you accept it. A rule can only test a value
        some step in this workflow already reads.
      </p>

      {state.kind === 'proposed' && (
        <div
          className="mt-3 rounded-md border border-indigo-200 bg-white p-3"
          data-testid="rule-proposal"
        >
          <p className="text-xs font-semibold tracking-wide text-indigo-700 uppercase">
            Orbit proposes
          </p>
          <ul className="mt-1.5 flex flex-col gap-0.5 text-sm text-slate-800">
            {describeProposedRule(state.step, state.insertAfterStepId).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <button
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
              data-testid="rule-accept"
              onClick={() => void add(state.step, state.insertAtIndex)}
              type="button"
            >
              Add this step
            </button>
            <button
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              data-testid="rule-discard"
              onClick={() => setState({ kind: 'idle' })}
              type="button"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {state.kind === 'refused' && (
        <div
          className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3"
          data-testid="rule-refusal"
        >
          <p className="text-sm text-amber-900">{state.message}</p>
          {state.reasons.length > 0 && (
            <ul className="mt-1.5 flex list-disc flex-col gap-0.5 pl-4 text-xs text-amber-800">
              {state.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
