import type { SopReviewStepView } from '@orbit/api/views';

import { workflowRules, type WorkflowRule } from './sop-review-view-model';

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
export function SopRulesPanel({ steps }: { readonly steps: readonly SopReviewStepView[] }) {
  const rules = workflowRules(steps);

  if (rules.length === 0) {
    return null;
  }

  const modelCalls = rules.filter((rule) => rule.resolution === 'judged').length;

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
                  {branch.when} → <span className="font-mono">{branch.nextStepId}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
