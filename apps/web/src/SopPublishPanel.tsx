import type { SopDeclaredOutcomeView, SopPublicationView } from '@orbit/api/views';
import { useState } from 'react';

import {
  canApprove,
  canCompile,
  canPublish,
  compileBlockedReason,
  publicationStage,
  publicationSummary,
  type ApproveFailure,
  type CompileFailure,
  type PublishFailure,
} from './publication-view-model';

const BUSINESS_OUTCOMES = ['request_found', 'request_not_found'] as const;

/**
 * Compiling, approving and publishing, on the review page.
 *
 * All three read as one panel because they are one progression — but each is
 * offered only at the stage that actually permits it, and none of them ever
 * touches the "draft only" notice above: the SOP Graph stays non-executable by
 * construction after every one of them (ADR-016). Publishing produces a
 * separate artifact; compiling and approving produce a separate row on the way
 * to it.
 */
export function SopPublishPanel(props: {
  readonly publication: SopPublicationView;
  readonly revisionState: string;
  readonly declaredOutcomes: readonly SopDeclaredOutcomeView[];
  readonly isCompiling: boolean;
  readonly isApproving: boolean;
  readonly isPublishing: boolean;
  readonly compileFailure: CompileFailure | null;
  readonly approveFailure: ApproveFailure | null;
  readonly publishFailure: PublishFailure | null;
  readonly onCompile: (outcomeMapping: Readonly<Record<string, string>>) => void;
  readonly onApprove: (candidateId: string) => void;
  readonly onPublish: (candidateId: string) => void;
  readonly onOpenAgent: (agentVersionId: string) => void;
}): React.JSX.Element {
  const stage = publicationStage(props.publication);
  const [outcomeMapping, setOutcomeMapping] = useState<Record<string, string>>({});

  const blockedReason = compileBlockedReason({
    stage,
    revisionState: props.revisionState,
    declaredOutcomeCount: props.declaredOutcomes.length,
  });

  const readyToCompile =
    canCompile({
      stage,
      revisionState: props.revisionState,
      declaredOutcomeCount: props.declaredOutcomes.length,
    }) && props.declaredOutcomes.every((outcome) => outcomeMapping[outcome.name] !== undefined);

  return (
    <section className="rounded border border-slate-200 p-4" data-testid="sop-publish-panel">
      <h3 className="text-sm font-semibold text-slate-900">Running this workflow</h3>
      <p className="mt-1 text-sm text-slate-600" data-testid="sop-publish-summary">
        {publicationSummary(stage)}
      </p>

      {stage.kind === 'not_compiled' && blockedReason !== null ? (
        <p className="mt-3 text-sm text-slate-500" data-testid="compile-blocked-reason">
          {blockedReason}
        </p>
      ) : null}

      {stage.kind === 'not_compiled' && blockedReason === null ? (
        <div className="mt-3 flex flex-col gap-3" data-testid="outcome-mapping-form">
          <p className="text-xs text-slate-600">
            Say what each outcome this workflow can reach means in business terms, so the agent
            reports it the same way a run does today.
          </p>

          {props.declaredOutcomes.map((outcome) => (
            <label className="flex flex-col gap-1 text-sm text-slate-800" key={outcome.name}>
              <span>
                <span className="font-medium">{outcome.name}</span> — {outcome.message}
              </span>
              <select
                className="rounded border border-slate-300 px-2 py-1 text-sm"
                data-testid={`outcome-mapping-${outcome.name}`}
                onChange={(event) => {
                  const { value } = event.target;
                  setOutcomeMapping((current) => {
                    if (value === '') {
                      return Object.fromEntries(
                        Object.entries(current).filter(([name]) => name !== outcome.name),
                      );
                    }
                    return { ...current, [outcome.name]: value };
                  });
                }}
                value={outcomeMapping[outcome.name] ?? ''}
              >
                <option value="">Choose what this means…</option>
                {BUSINESS_OUTCOMES.map((businessOutcome) => (
                  <option key={businessOutcome} value={businessOutcome}>
                    {businessOutcome}
                  </option>
                ))}
              </select>
            </label>
          ))}

          <button
            className="w-fit rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:bg-slate-400"
            data-testid="compile-agent-button"
            disabled={props.isCompiling || !readyToCompile}
            onClick={() => {
              props.onCompile(outcomeMapping);
            }}
            type="button"
          >
            {props.isCompiling ? 'Compiling…' : 'Turn into an agent'}
          </button>
        </div>
      ) : null}

      {canApprove(stage) ? (
        <button
          className="mt-3 rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:bg-slate-400"
          data-testid="approve-candidate-button"
          disabled={props.isApproving}
          onClick={() => {
            props.onApprove(stage.candidateId);
          }}
          type="button"
        >
          {props.isApproving ? 'Approving…' : 'Approve for publishing'}
        </button>
      ) : null}

      {canPublish(stage) && stage.kind === 'publishable' ? (
        <button
          className="mt-3 rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:bg-slate-400"
          data-testid="publish-agent-button"
          disabled={props.isPublishing}
          onClick={() => {
            props.onPublish(stage.candidateId);
          }}
          type="button"
        >
          {props.isPublishing ? 'Publishing…' : 'Publish as an agent'}
        </button>
      ) : null}

      {stage.kind === 'published' ? (
        <button
          className="mt-3 rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-900"
          data-testid="open-published-agent"
          onClick={() => {
            props.onOpenAgent(stage.agentVersionId);
          }}
          type="button"
        >
          Open the published agent →
        </button>
      ) : null}

      {props.compileFailure === null ? null : (
        <div
          className="mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900"
          data-testid="compile-failure"
        >
          <p>{props.compileFailure.message}</p>
          {props.compileFailure.refusals.length > 0 ? (
            <ul className="mt-1 list-disc pl-4">
              {props.compileFailure.refusals.map((refusal) => (
                <li data-testid="compile-refusal" key={refusal}>
                  {refusal}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      {props.approveFailure === null ? null : (
        <p
          className="mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900"
          data-testid="approve-failure"
        >
          {props.approveFailure.message}
        </p>
      )}

      {props.publishFailure === null ? null : (
        <p
          className="mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900"
          data-testid="publish-failure"
        >
          {props.publishFailure.message}
        </p>
      )}
    </section>
  );
}
