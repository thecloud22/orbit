import type { SopDeclaredOutcomeView, SopPublicationView } from '@orbit/api/views';
import { useState } from 'react';

import {
  offersBoundPublish,
  offersOneClickPublish,
  publicationStage,
  publicationSummary,
  type CompileFailure,
} from './publication-view-model';

const BUSINESS_OUTCOMES = ['request_found', 'request_not_found'] as const;

/**
 * What a workflow's single conclusion means, when it only has one.
 *
 * `request_found` is Agent IR's "the workflow reached its intended end"
 * (`terminalBusinessOutcomeSchema`), and its name is inherited from the seeded
 * Phase 1 agent rather than chosen to describe workflows generally. That is a
 * contract-level wart, not a UI one, so this defaults around it instead of
 * asking a person to pick a word that does not describe what they recorded.
 */
const DEFAULT_OUTCOME = 'request_found';

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
 * A workflow that was not recorded gets the same one action once every step
 * the compiler needs a binding for has an approved, up-to-date one (ADR-027).
 * That is a technical precondition rather than a review waiver: binding each
 * step is the same confirmation against a real page a recording gives, just
 * assembled one step at a time. Until it is met, the panel says what is
 * missing instead of offering a button that could only ever be refused.
 *
 * None of this ever touches the "draft only" notice above — the SOP Graph
 * stays non-executable by construction throughout (ADR-016); publishing
 * produces a separate artifact, not a change to this one.
 */
export function SopPublishPanel(props: {
  readonly publication: SopPublicationView;
  readonly provenanceKind: string;
  /** Every step the compiler needs a binding for has an approved, fresh one. */
  readonly fullyBound: boolean;
  readonly declaredOutcomes: readonly SopDeclaredOutcomeView[];
  readonly isPublishing: boolean;
  readonly publishFailure: CompileFailure | null;
  readonly onPublish: (outcomeMapping: Readonly<Record<string, string>>) => void;
  readonly onOpenAgent: (agentVersionId: string) => void;
}): React.JSX.Element {
  const stage = publicationStage(props.publication);
  const [outcomeMapping, setOutcomeMapping] = useState<Record<string, string>>({});

  const recorded = offersOneClickPublish({ provenanceKind: props.provenanceKind, stage });
  const bound = offersBoundPublish({
    provenanceKind: props.provenanceKind,
    stage,
    fullyBound: props.fullyBound,
  });
  const oneClick = recorded || bound;
  const hasOutcomes = props.declaredOutcomes.length > 0;

  /**
   * What each outcome means, asked only when it is genuinely a question.
   *
   * A workflow that reaches exactly one conclusion has nothing to disambiguate:
   * it either finished or it did not, and the recorder appends precisely one
   * such outcome. Asking anyway meant answering an obvious question in
   * vocabulary borrowed from the seeded Phase 1 agent, which does not describe
   * most workflows at all. Two or more outcomes is a real branch, and there a
   * person still has to say which conclusion is which.
   */
  const asksAboutOutcomes = props.declaredOutcomes.length > 1;
  const effectiveMapping = asksAboutOutcomes
    ? outcomeMapping
    : Object.fromEntries(props.declaredOutcomes.map((outcome) => [outcome.name, DEFAULT_OUTCOME]));
  const mappingComplete = props.declaredOutcomes.every(
    (outcome) => effectiveMapping[outcome.name] !== undefined,
  );
  const showForm = oneClick && stage.kind !== 'cannot_validate';

  const summary =
    stage.kind === 'published'
      ? publicationSummary(stage)
      : oneClick
        ? stage.kind === 'cannot_validate'
          ? publicationSummary(stage)
          : asksAboutOutcomes
            ? 'This workflow can end more than one way. Say which is which, then publish it as a runnable agent.'
            : 'Publish this workflow as a runnable agent.'
        : 'Every step of this workflow has to be bound to a real page before it can run. Bind the steps below, then publish.';

  return (
    <section
      className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
      data-testid="sop-publish-panel"
    >
      <h3 className="text-sm font-semibold text-slate-900">Publish</h3>
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
          {(asksAboutOutcomes ? props.declaredOutcomes : []).map((outcome) => (
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
              props.onPublish(effectiveMapping);
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
