import type { SopDeclaredOutcomeView, SopPublicationView } from '@orbit/api/views';
import { useState } from 'react';

import {
  offersOneClickPublish,
  publicationStage,
  publicationSummary,
  type CompileFailure,
} from './publication-view-model';

const BUSINESS_OUTCOMES = ['request_found', 'request_not_found'] as const;

/**
 * Turning a workflow into a runnable agent, on the review page.
 *
 * A recorded workflow gets one action: answer what each outcome means, then
 * publish. Everything else — approving the revision, compiling it, approving
 * the candidate — happens in one call rather than one screen each, because a
 * person demonstrated every action personally and asking them to separately
 * confirm a sequence they just finished performing is ceremony, not review
 * (`publish-recording-service.ts` and ADR-024 explain the line this draws and
 * why the fail-closed secret check still applies regardless).
 *
 * A workflow that was not recorded gets an honest note instead of a button:
 * nothing today can map its steps to a real page, so offering to compile it
 * would only ever fail. None of this ever touches the "draft only" notice
 * above — the SOP Graph stays non-executable by construction throughout
 * (ADR-016); publishing produces a separate artifact, not a change to this
 * one.
 */
export function SopPublishPanel(props: {
  readonly publication: SopPublicationView;
  readonly provenanceKind: string;
  readonly declaredOutcomes: readonly SopDeclaredOutcomeView[];
  readonly isPublishing: boolean;
  readonly publishFailure: CompileFailure | null;
  readonly onPublish: (outcomeMapping: Readonly<Record<string, string>>) => void;
  readonly onOpenAgent: (agentVersionId: string) => void;
}): React.JSX.Element {
  const stage = publicationStage(props.publication);
  const [outcomeMapping, setOutcomeMapping] = useState<Record<string, string>>({});

  const oneClick = offersOneClickPublish({ provenanceKind: props.provenanceKind, stage });
  const hasOutcomes = props.declaredOutcomes.length > 0;
  const mappingComplete = props.declaredOutcomes.every(
    (outcome) => outcomeMapping[outcome.name] !== undefined,
  );
  const showForm = oneClick && stage.kind !== 'cannot_validate';

  const summary =
    stage.kind === 'published'
      ? publicationSummary(stage)
      : oneClick
        ? stage.kind === 'cannot_validate'
          ? publicationSummary(stage)
          : 'Say what each outcome means, then publish this workflow as a runnable agent.'
        : "This workflow needs its steps mapped to a real page before it can run, and that isn't built yet. Recording the workflow instead works today.";

  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
      data-testid="sop-publish-panel"
    >
      <h3 className="text-sm font-semibold text-slate-900">Running this workflow</h3>
      <p className="mt-1 text-sm text-slate-600" data-testid="sop-publish-summary">
        {summary}
      </p>

      {showForm && !hasOutcomes ? (
        <p className="mt-3 text-sm text-slate-500" data-testid="publish-blocked-reason">
          This workflow has no outcome step yet, so it has nothing to publish.
        </p>
      ) : null}

      {showForm && hasOutcomes ? (
        <div className="mt-3 flex flex-col gap-3" data-testid="outcome-mapping-form">
          {props.declaredOutcomes.map((outcome) => (
            <label className="flex flex-col gap-1 text-sm text-slate-800" key={outcome.name}>
              <span>
                <span className="font-medium">{outcome.name}</span> — {outcome.message}
              </span>
              <select
                className="rounded-md border border-slate-300 px-2 py-1 text-sm"
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
            className="w-fit rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:bg-slate-300"
            data-testid="publish-recording-button"
            disabled={props.isPublishing || !mappingComplete}
            onClick={() => {
              props.onPublish(outcomeMapping);
            }}
            type="button"
          >
            {props.isPublishing ? 'Publishing…' : 'Publish this workflow'}
          </button>
        </div>
      ) : null}

      {stage.kind === 'published' ? (
        <button
          className="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-900"
          data-testid="open-published-agent"
          onClick={() => {
            props.onOpenAgent(stage.agentVersionId);
          }}
          type="button"
        >
          Open the published agent →
        </button>
      ) : null}

      {props.publishFailure === null ? null : (
        <div
          className="mt-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900"
          data-testid="publish-failure"
        >
          <p data-testid="publish-failure-message">{props.publishFailure.message}</p>
          {props.publishFailure.refusals.length > 0 ? (
            <ul className="mt-1 list-disc pl-4">
              {props.publishFailure.refusals.map((refusal) => (
                <li data-testid="publish-refusal" key={refusal}>
                  {refusal}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </section>
  );
}
