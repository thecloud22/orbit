import { useCallback, useEffect, useState } from 'react';

import type { SopBindingsView, SopReviewView } from '@orbit/api/views';

import {
  answerSopQuestion,
  ApiRequestError,
  editSopStep,
  getSopBindings,
  getSopReview,
  publishBoundDocument,
  publishRecording,
  reorderSopStep,
  startBindingSession,
  targetBindingStep,
  transitionSopRevision,
} from './api-client';
import { BindingSessionPanel } from './BindingSessionPanel';
import {
  describeBindingSessionFailure,
  suggestedStartUrl,
  type BindingFailure,
} from './binding-session-view-model';
import { isFullyBoundForPublish } from './sop-binding-view-model';
import { describePublishRecordingFailure, type CompileFailure } from './publication-view-model';
import { SopBindingPanel } from './SopBindingPanel';
import { SopPublishPanel } from './SopPublishPanel';
import { SopStepEditor } from './SopStepEditor';
import {
  describeReviewFailure,
  reviewActions,
  stateLabel,
  submitBlockedReason,
  type ReviewFailure,
} from './sop-review-view-model';
import { DRAFT_NOT_EXECUTABLE_NOTICE } from './sop-draft-view-model';

export interface SopReviewPageProps {
  readonly documentId: string;
  /** Navigates to the agent publishing produced. The document itself is unchanged. */
  readonly onOpenAgent: (agentVersionId: string) => void;
  /** The open binding session, from the URL, so a reload reattaches to it. */
  readonly bindingSessionId: string | null;
  readonly onBindingSessionChange: (sessionId: string | null) => void;
}

/**
 * Reviewing one SOP Graph revision.
 *
 * Every write here creates a *new* revision rather than changing the one on
 * screen, so after any successful action the view is reloaded from the server
 * — the revision id the page was showing has just been superseded, and
 * continuing to edit against it would be editing history.
 */
export function SopReviewPage({
  documentId,
  onOpenAgent,
  bindingSessionId,
  onBindingSessionChange,
}: SopReviewPageProps) {
  const [review, setReview] = useState<SopReviewView | null>(null);
  const [bindings, setBindings] = useState<SopBindingsView | null>(null);
  const [failure, setFailure] = useState<ReviewFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isPublishingRecording, setIsPublishingRecording] = useState(false);
  const [publishRecordingFailure, setPublishRecordingFailure] = useState<CompileFailure | null>(
    null,
  );
  const [isStartingBinding, setIsStartingBinding] = useState(false);
  const [bindingFailure, setBindingFailure] = useState<BindingFailure | null>(null);
  const [startUrl, setStartUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Loaded alongside the review, and deliberately not fatal: binding
    // visibility is additional information about a workflow, so failing to
    // fetch it must not stop the workflow itself being reviewed.
    void getSopBindings(documentId)
      .then(setBindings)
      .catch(() => setBindings(null));

    try {
      setReview(await getSopReview(documentId));
      setFailure(null);
    } catch (caught) {
      setFailure(
        describeReviewFailure(
          caught instanceof ApiRequestError
            ? caught
            : new ApiRequestError({ status: 0, message: 'The API could not be reached.' }),
        ),
      );
    }
  }, [documentId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Suggested once from the workflow's own navigate step, then left alone: a
  // person who corrected it must not have their correction overwritten by the
  // next reload.
  useEffect(() => {
    if (review !== null && startUrl === null) {
      setStartUrl(suggestedStartUrl(review.steps));
    }
  }, [review, startUrl]);

  /**
   * Opens a browser aimed at one step, or points an already-open one at it.
   *
   * A sitting rather than a session per step: binding a workflow means binding
   * several steps in sequence, and each starts where the last left the page.
   */
  async function bindStep(stepId: string) {
    setIsStartingBinding(true);
    setBindingFailure(null);

    try {
      const session =
        bindingSessionId === null
          ? await startBindingSession({
              documentId,
              stepId,
              startUrl: startUrl ?? '',
            })
          : await targetBindingStep(bindingSessionId, stepId);

      onBindingSessionChange(session.sessionId);
    } catch (caught) {
      setBindingFailure(
        describeBindingSessionFailure(
          caught instanceof ApiRequestError
            ? caught
            : new ApiRequestError({ status: 0, message: 'The API could not be reached.' }),
        ),
      );
    } finally {
      setIsStartingBinding(false);
    }
  }

  /** Runs a write, then reloads — the revision on screen no longer exists. */
  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setFailure(null);

    try {
      await work();
      setEditingStepId(null);
      await load();
    } catch (caught) {
      setFailure(
        describeReviewFailure(
          caught instanceof ApiRequestError
            ? caught
            : new ApiRequestError({ status: 0, message: 'The API could not be reached.' }),
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  if (review === null) {
    return failure === null ? (
      <p className="text-sm text-slate-600">Loading the workflow…</p>
    ) : (
      <FailureNotice failure={failure} />
    );
  }

  const blocked = submitBlockedReason(review);

  return (
    <section className="flex flex-col gap-4" data-testid="sop-review">
      <header className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p
          className="rounded bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900"
          data-testid="sop-review-not-executable"
        >
          {DRAFT_NOT_EXECUTABLE_NOTICE}
        </p>

        <h2 className="mt-3 text-base font-semibold text-slate-900" data-testid="sop-review-title">
          {review.title}
        </h2>
        <p className="text-xs text-slate-500" data-testid="sop-review-state">
          Revision {review.revisionNumber} · {stateLabel(review.state)}
        </p>

        <div className="mt-3 flex flex-wrap gap-2" data-testid="sop-lifecycle-actions">
          {reviewActions(review).map((action) => (
            <button
              className={
                action.emphasis === 'primary'
                  ? 'rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:bg-slate-300'
                  : 'rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:text-slate-400'
              }
              data-testid={`sop-action-${action.action}`}
              disabled={busy}
              key={action.action}
              onClick={() =>
                void act(() => transitionSopRevision(review.revisionId, action.action))
              }
              type="button"
            >
              {action.label}
            </button>
          ))}
        </div>

        {blocked !== null && (
          <p className="mt-2 text-xs text-amber-900" data-testid="sop-submit-blocked">
            {blocked}
          </p>
        )}
      </header>

      {failure !== null && <FailureNotice failure={failure} />}

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">Steps</h3>
        <ol className="mt-2 flex flex-col gap-2" data-testid="sop-review-steps">
          {review.steps.map((step) => (
            <li
              className="rounded-md border border-slate-200 p-3 transition-colors hover:border-slate-300"
              data-testid="sop-review-step"
              key={step.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm text-slate-900">
                    <span className="mr-2 text-xs text-slate-500">{step.position}.</span>
                    <span className="mr-2 font-mono text-xs text-slate-500">{step.kind}</span>
                    <span data-testid="sop-review-step-summary">{step.summary}</span>
                  </p>
                  {step.produces.length > 0 && (
                    <p className="mt-1 text-xs text-slate-500">
                      Produces: {step.produces.join(', ')}
                    </p>
                  )}
                </div>

                {review.editable && (
                  <div className="flex gap-1">
                    <button
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs disabled:text-slate-300"
                      data-testid={`sop-step-move-up-${step.id}`}
                      disabled={busy || !step.canMoveUp}
                      onClick={() =>
                        void act(() => reorderSopStep(review.revisionId, step.id, 'up'))
                      }
                      type="button"
                    >
                      ↑
                    </button>
                    <button
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs disabled:text-slate-300"
                      data-testid={`sop-step-move-down-${step.id}`}
                      disabled={busy || !step.canMoveDown}
                      onClick={() =>
                        void act(() => reorderSopStep(review.revisionId, step.id, 'down'))
                      }
                      type="button"
                    >
                      ↓
                    </button>
                    <button
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                      data-testid={`sop-step-edit-${step.id}`}
                      onClick={() => setEditingStepId(editingStepId === step.id ? null : step.id)}
                      type="button"
                    >
                      Edit
                    </button>
                  </div>
                )}
              </div>

              {editingStepId === step.id && (
                <SopStepEditor
                  isSaving={busy}
                  onCancel={() => setEditingStepId(null)}
                  onSave={(edited, note) =>
                    void act(() => editSopStep(review.revisionId, step.id, edited, note))
                  }
                  step={step}
                />
              )}
            </li>
          ))}
        </ol>
      </section>

      <SopPublishPanel
        declaredOutcomes={review.declaredOutcomes}
        fullyBound={isFullyBoundForPublish(bindings)}
        isPublishing={isPublishingRecording}
        onOpenAgent={onOpenAgent}
        onPublish={(outcomeMapping) => {
          setIsPublishingRecording(true);
          setPublishRecordingFailure(null);

          const publish =
            review.provenance.kind === 'recorded' ? publishRecording : publishBoundDocument;

          void publish(documentId, outcomeMapping)
            .then(() => load())
            .catch((error: unknown) => {
              setPublishRecordingFailure(
                error instanceof ApiRequestError
                  ? describePublishRecordingFailure(error)
                  : { message: 'This workflow could not be published.', refusals: [] },
              );
            })
            .finally(() => {
              setIsPublishingRecording(false);
            });
        }}
        provenanceKind={review.provenance.kind}
        publication={review.publication}
        publishFailure={publishRecordingFailure}
      />

      <SopBindingPanel
        bindings={bindings}
        isStarting={isStartingBinding}
        onBind={(stepId) => void bindStep(stepId)}
        onStartUrlChange={setStartUrl}
        startUrl={bindingSessionId === null ? (startUrl ?? '') : null}
        steps={review.steps}
      />

      {bindingFailure !== null && (
        <section
          className="rounded border border-rose-300 bg-rose-50 p-4"
          data-testid="binding-start-failure"
        >
          <h3 className="text-sm font-semibold text-rose-900">{bindingFailure.title}</h3>
          <p className="mt-1 text-sm text-rose-900">{bindingFailure.message}</p>
        </section>
      )}

      {bindingSessionId !== null && (
        <BindingSessionPanel
          onClosed={() => {
            onBindingSessionChange(null);
            void load();
          }}
          onSaved={() => void load()}
          sessionId={bindingSessionId}
        />
      )}

      {review.clarifications.length > 0 && (
        <section
          className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
          data-testid="sop-clarifications"
        >
          <h3 className="text-sm font-semibold text-slate-900">Questions Orbit needs answered</h3>
          <ul className="mt-2 flex flex-col gap-3">
            {review.clarifications.map((entry) => (
              <li data-testid="sop-clarification" key={entry.questionId}>
                <p className="text-sm text-slate-900">{entry.question}</p>
                {entry.aboutStepSummary !== null && (
                  <p className="text-xs text-slate-500">About: {entry.aboutStepSummary}</p>
                )}

                {entry.answer === null ? (
                  review.editable && (
                    <div className="mt-1 flex flex-wrap gap-2">
                      <input
                        className="min-w-64 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
                        data-testid={`sop-answer-input-${entry.questionId}`}
                        onChange={(event) =>
                          setAnswers((current) => ({
                            ...current,
                            [entry.questionId]: event.target.value,
                          }))
                        }
                        placeholder="Your answer"
                        value={answers[entry.questionId] ?? ''}
                      />
                      <button
                        className="rounded-md bg-indigo-600 px-3 py-1 text-sm text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:bg-slate-300"
                        data-testid={`sop-answer-save-${entry.questionId}`}
                        disabled={busy || (answers[entry.questionId] ?? '').trim() === ''}
                        onClick={() =>
                          void act(() =>
                            answerSopQuestion(
                              review.revisionId,
                              entry.questionId,
                              (answers[entry.questionId] ?? '').trim(),
                            ),
                          )
                        }
                        type="button"
                      >
                        Answer
                      </button>
                    </div>
                  )
                ) : (
                  <p className="mt-1 text-sm text-slate-700" data-testid="sop-clarification-answer">
                    <span className="text-xs text-slate-500">Answered: </span>
                    {entry.answer}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {review.assumptions.length > 0 && (
        <section
          className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
          data-testid="sop-review-assumptions"
        >
          <h3 className="text-sm font-semibold text-slate-900">Assumptions Orbit made</h3>
          <ul className="mt-1 list-disc pl-5 text-sm text-slate-800">
            {review.assumptions.map((assumption) => (
              <li key={assumption.id}>{assumption.statement}</li>
            ))}
          </ul>
        </section>
      )}

      {review.risks.length > 0 && (
        <section
          className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
          data-testid="sop-review-risks"
        >
          <h3 className="text-sm font-semibold text-slate-900">Risks</h3>
          <ul className="mt-1 list-disc pl-5 text-sm text-slate-800">
            {review.risks.map((risk) => (
              <li key={risk.id}>
                {risk.statement} <span className="text-xs text-slate-500">({risk.severity})</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

function FailureNotice({ failure }: { readonly failure: ReviewFailure }) {
  return (
    <section
      className="rounded border border-rose-300 bg-rose-50 p-4"
      data-testid="sop-review-failure"
    >
      <h3 className="text-sm font-semibold text-rose-900" data-testid="sop-review-failure-title">
        {failure.title}
      </h3>
      <p className="mt-1 text-sm text-rose-900" data-testid="sop-review-failure-message">
        {failure.message}
      </p>
      {failure.issues.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-rose-900" data-testid="sop-review-issues">
          {failure.issues.map((issue) => (
            <li key={`${issue.where}:${issue.message}`}>
              <span className="font-medium">{issue.where}</span>: {issue.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
