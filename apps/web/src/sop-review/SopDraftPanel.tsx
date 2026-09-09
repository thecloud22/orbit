import type { SopDraftView } from '@orbit/api/views';

import {
  DRAFT_NOT_EXECUTABLE_NOTICE,
  numberedSteps,
  summarizeSopDraft,
  type SopDraftFailure,
} from './sop-draft-view-model';

export interface SopDraftPanelProps {
  readonly draft: SopDraftView | null;
  readonly failure: SopDraftFailure | null;
}

/**
 * What came back, in plain language.
 *
 * Raw JSON is never shown: the requirements document is explicit that the
 * standard experience must not expose it by default. This renders the fields a
 * reviewer needs to judge whether the draft matches what they described.
 */
export function SopDraftPanel({ draft, failure }: SopDraftPanelProps) {
  if (failure !== null) {
    return (
      <section
        className="rounded border border-rose-300 bg-rose-50 p-4"
        data-testid="sop-draft-failure"
      >
        <h2 className="text-sm font-semibold text-rose-900" data-testid="sop-draft-failure-title">
          {failure.title}
        </h2>
        <p className="mt-1 text-sm text-rose-900" data-testid="sop-draft-failure-message">
          {failure.message}
        </p>
        {failure.issues.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-xs text-rose-900" data-testid="sop-draft-issues">
            {failure.issues.map((issue) => (
              <li key={`${issue.where}:${issue.message}`}>
                <span className="font-medium">{issue.where}</span>: {issue.message}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-rose-900">Nothing was saved.</p>
      </section>
    );
  }

  if (draft === null) {
    return null;
  }

  const summary = summarizeSopDraft(draft);

  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
      data-testid="sop-draft"
    >
      <p
        className="rounded bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900"
        data-testid="sop-draft-not-executable"
      >
        {DRAFT_NOT_EXECUTABLE_NOTICE}
      </p>

      <h2 className="mt-3 text-base font-semibold text-slate-900" data-testid="sop-draft-title">
        {summary.title}
      </h2>
      <p className="text-xs text-slate-500" data-testid="sop-draft-revision">
        {summary.revisionLabel} · {summary.generatedBy}
      </p>

      <Group title={`Steps (${summary.stepCount})`} testId="sop-draft-steps">
        <ol className="list-decimal pl-5 text-sm text-slate-800">
          {numberedSteps(draft).map((step) => (
            <li key={step.id} data-testid="sop-draft-step">
              <span className="font-mono text-xs text-slate-500">{step.kind}</span> {step.summary}
            </li>
          ))}
        </ol>
      </Group>

      {draft.inputs.length > 0 && (
        <Group title="Values a run must supply" testId="sop-draft-inputs">
          <ul className="list-disc pl-5 text-sm text-slate-800">
            {draft.inputs.map((declared) => (
              <li key={declared.id}>
                {declared.label}{' '}
                <span className="text-xs text-slate-500">
                  ({declared.type}
                  {declared.required ? ', required' : ', optional'})
                </span>
              </li>
            ))}
          </ul>
        </Group>
      )}

      {draft.assumptions.length > 0 && (
        <Group title="Assumptions Orbit made" testId="sop-draft-assumptions">
          <ul className="list-disc pl-5 text-sm text-slate-800">
            {draft.assumptions.map((assumption) => (
              <li key={assumption.id}>{assumption.statement}</li>
            ))}
          </ul>
        </Group>
      )}

      {draft.clarificationQuestions.length > 0 && (
        <Group
          title={`Questions Orbit needs answered (${summary.questionCount})`}
          testId="sop-draft-questions"
        >
          <ul className="list-disc pl-5 text-sm text-slate-800">
            {draft.clarificationQuestions.map((question) => (
              <li key={question.id} data-testid="sop-draft-question">
                {question.question}
              </li>
            ))}
          </ul>
          {/* Answering them is sub-phase 2.3; saying so beats an inert form. */}
          <p className="mt-1 text-xs text-slate-500">Answering these is not available yet.</p>
        </Group>
      )}

      {draft.risks.length > 0 && (
        <Group title="Risks" testId="sop-draft-risks">
          <ul className="list-disc pl-5 text-sm text-slate-800">
            {draft.risks.map((risk) => (
              <li key={risk.id}>
                {risk.statement} <span className="text-xs text-slate-500">({risk.severity})</span>
              </li>
            ))}
          </ul>
        </Group>
      )}
    </section>
  );
}

function Group({
  title,
  testId,
  children,
}: {
  readonly title: string;
  readonly testId: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="mt-4" data-testid={testId}>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <div className="mt-1">{children}</div>
    </div>
  );
}
