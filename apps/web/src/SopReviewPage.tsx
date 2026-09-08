import { Fragment, useCallback, useEffect, useState } from 'react';

import type { RecoveryProposalView, SopBindingsView, SopReviewView } from '@orbit/api/views';

import {
  answerSopQuestion,
  ApiRequestError,
  editSopStep,
  acceptRecoveryProposal,
  dismissRecoveryProposal,
  getRecoveryProposals,
  getSopBindings,
  getSopReview,
  insertSopStep,
  publishBoundDocument,
  publishRecording,
  reorderSopStep,
  startBindingSession,
  startWalkthrough,
  targetBindingStep,
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
import { WalkthroughPanel } from './WalkthroughPanel';
import {
  DECISION_NOTICE,
  describeWalkthroughFailure,
  WALKTHROUGH_LEAD,
} from './walkthrough-view-model';
import { SopPublishPanel } from './SopPublishPanel';
import { SopStepEditor } from './SopStepEditor';
import { SopStepInserter } from './SopStepInserter';
import {
  describeReviewFailure,
  publishBlockedReason,
  stateLabel,
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
  /** The open walkthrough, from the URL, for the same reason (ADR-035). */
  readonly walkthroughSessionId: string | null;
  readonly onWalkthroughSessionChange: (sessionId: string | null) => void;
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
  walkthroughSessionId,
  onWalkthroughSessionChange,
}: SopReviewPageProps) {
  const [review, setReview] = useState<SopReviewView | null>(null);
  const [bindings, setBindings] = useState<SopBindingsView | null>(null);
  const [proposals, setProposals] = useState<readonly RecoveryProposalView[]>([]);
  const [resolvingProposalId, setResolvingProposalId] = useState<string | null>(null);
  const [failure, setFailure] = useState<ReviewFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  /** The position an "Add a step" form is open at, or null when none is. */
  const [insertingAt, setInsertingAt] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isPublishingRecording, setIsPublishingRecording] = useState(false);
  const [publishRecordingFailure, setPublishRecordingFailure] = useState<CompileFailure | null>(
    null,
  );
  const [isStartingBinding, setIsStartingBinding] = useState(false);
  const [bindingFailure, setBindingFailure] = useState<BindingFailure | null>(null);
  const [startUrl, setStartUrl] = useState<string | null>(null);
  const [isStartingWalkthrough, setIsStartingWalkthrough] = useState(false);

  const load = useCallback(async () => {
    // Loaded alongside the review, and deliberately not fatal: binding
    // visibility is additional information about a workflow, so failing to
    // fetch it must not stop the workflow itself being reviewed.
    void getSopBindings(documentId)
      .then(setBindings)
      .catch(() => setBindings(null));

    // Same treatment, for the same reason: a document with no proposals and a
    // document whose proposals could not be fetched both read as "none here",
    // and neither is a reason to stop someone reviewing the workflow.
    void getRecoveryProposals(documentId)
      .then((view) => setProposals(view.proposals))
      .catch(() => setProposals([]));

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

  /**
   * Accepting or dismissing one proposal, then reloading.
   *
   * Accepting creates a new approved binding, so the binding panel and the
   * publish gate both change underneath it — reloading is how they stay
   * truthful rather than optimistically patched in place. It deliberately does
   * *not* start a run: accepting makes the next run possible and starting one
   * stays a separate, human act (ADR-033).
   */
  const resolveProposal = useCallback(
    async (proposalId: string, action: 'accept' | 'dismiss') => {
      setResolvingProposalId(proposalId);

      try {
        if (action === 'accept') {
          await acceptRecoveryProposal(documentId, proposalId);
        } else {
          await dismissRecoveryProposal(documentId, proposalId);
        }

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
        setResolvingProposalId(null);
      }
    },
    [documentId, load],
  );

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

  /**
   * Opens one browser for the whole workflow (ADR-035).
   *
   * Deliberately a sibling of `bindStep` rather than a mode of it: this one
   * names no step, because what is being demonstrated is the task. It produces
   * proposals a person reviews, and `bindStep` stays exactly as it was — the
   * faster route is additional, and it replaces nothing.
   */
  async function startWholeWorkflow() {
    setIsStartingWalkthrough(true);
    setBindingFailure(null);

    try {
      const session = await startWalkthrough({ documentId, startUrl: startUrl ?? '' });
      onWalkthroughSessionChange(session.sessionId);
    } catch (caught) {
      const error =
        caught instanceof ApiRequestError
          ? caught
          : new ApiRequestError({ status: 0, message: 'The API could not be reached.' });
      const described = describeWalkthroughFailure(error);

      // Reported through the same notice the per-step flow uses, so a person
      // sees one place where "the browser could not be opened" is said.
      setBindingFailure({
        kind:
          described.kind === 'gone'
            ? 'gone'
            : described.kind === 'conflict'
              ? 'in_use'
              : described.kind === 'refused'
                ? 'refused'
                : 'request_failed',
        title: described.title,
        message: described.message,
        // No browser was ever opened, so there is nothing still standing to go
        // back to. Saying otherwise would tell somebody to look for a window
        // that does not exist.
        sessionSurvived: false,
        issues: [],
      });
    } finally {
      setIsStartingWalkthrough(false);
    }
  }

  /** Runs a write, then reloads — the revision on screen no longer exists. */
  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setFailure(null);

    try {
      await work();
      setEditingStepId(null);
      setInsertingAt(null);
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

  /**
   * The "Add a step" affordance, offered before the first step and after each.
   *
   * A position rather than a step: what a person is choosing is where the new
   * step goes, and position 0 is the one that matters most — it is the only
   * place that changes where the workflow begins, which the server handles by
   * moving `entryStepId` (ADR-030).
   */
  // Read out of the narrowed value rather than off `review` inside the closure:
  // TypeScript does not carry the null check above into a function body.
  const { editable, revisionId } = review;

  function insertSlot(index: number) {
    if (!editable) {
      return null;
    }

    return (
      <li data-testid={`sop-step-insert-slot-${String(index)}`}>
        {insertingAt === index ? (
          <SopStepInserter
            index={index}
            isSaving={busy}
            onCancel={() => setInsertingAt(null)}
            onInsert={(step, note) => void act(() => insertSopStep(revisionId, index, step, note))}
          />
        ) : (
          <button
            className="rounded-md border border-dashed border-slate-300 px-2 py-1 text-xs text-slate-500 transition-colors hover:border-indigo-400 hover:text-indigo-700"
            data-testid={`sop-step-insert-${String(index)}`}
            disabled={busy}
            onClick={() => setInsertingAt(index)}
            type="button"
          >
            + Add a step here
          </button>
        )}
      </li>
    );
  }

  const blocked = publishBlockedReason(review);

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

        {blocked !== null && (
          <p className="mt-2 text-xs text-amber-900" data-testid="sop-publish-blocked">
            {blocked}
          </p>
        )}
      </header>

      {failure !== null && <FailureNotice failure={failure} />}

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">Steps</h3>
        <ol className="mt-2 flex flex-col gap-2" data-testid="sop-review-steps">
          {review.steps.map((step, position) => (
            <Fragment key={step.id}>
              {insertSlot(position)}
              <li
                className="rounded-md border border-slate-200 p-3 transition-colors hover:border-slate-300"
                data-testid="sop-review-step"
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
            </Fragment>
          ))}
          {insertSlot(review.steps.length)}
        </ol>
      </section>

      <SopPublishPanel
        declaredOutcomes={review.declaredOutcomes}
        fullyBound={isFullyBoundForPublish(bindings)}
        isPublishing={isPublishingRecording}
        onOpenAgent={onOpenAgent}
        onPublish={() => {
          setIsPublishingRecording(true);
          setPublishRecordingFailure(null);

          const publish =
            review.provenance.kind === 'recorded' ? publishRecording : publishBoundDocument;

          void publish(documentId)
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

      {walkthroughSessionId === null ? (
        <StartWalkthrough
          disabled={busy || bindingSessionId !== null}
          isStarting={isStartingWalkthrough}
          onStart={() => void startWholeWorkflow()}
        />
      ) : (
        <WalkthroughPanel
          documentId={documentId}
          onBindStep={(stepId) => {
            // Straight to the flow that already existed, unchanged: a wrong
            // proposal is fixed by demonstrating that one step.
            onWalkthroughSessionChange(null);
            void bindStep(stepId);
          }}
          onChanged={() => void load()}
          onClosed={() => {
            onWalkthroughSessionChange(null);
            void load();
          }}
          sessionId={walkthroughSessionId}
        />
      )}

      <SopBindingPanel
        bindings={bindings}
        isStarting={isStartingBinding}
        onBind={(stepId) => void bindStep(stepId)}
        onAcceptProposal={(proposalId) => void resolveProposal(proposalId, 'accept')}
        onDismissProposal={(proposalId) => void resolveProposal(proposalId, 'dismiss')}
        onStartUrlChange={setStartUrl}
        proposals={proposals}
        resolvingProposalId={resolvingProposalId}
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

/**
 * The offer to bind everything at once (ADR-035).
 *
 * Sits above the per-step panel rather than inside it, because it is about the
 * workflow rather than about any one step — and because the per-step flow below
 * it is unchanged and must not read as having been replaced.
 */
function StartWalkthrough({
  onStart,
  isStarting,
  disabled,
}: {
  readonly onStart: () => void;
  readonly isStarting: boolean;
  readonly disabled: boolean;
}) {
  return (
    <section
      className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-5 shadow-sm"
      data-testid="walkthrough-offer"
    >
      <h3 className="text-sm font-semibold text-slate-900">Bind every step in one walkthrough</h3>
      <p className="mt-1 text-sm text-slate-700">{WALKTHROUGH_LEAD}</p>

      <button
        className="mt-3 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:bg-slate-300"
        data-testid="walkthrough-start"
        disabled={disabled || isStarting}
        onClick={onStart}
        type="button"
      >
        {isStarting ? 'Opening a browser…' : 'Start a walkthrough'}
      </button>

      <p className="mt-2 text-xs text-slate-500" data-testid="walkthrough-offer-decisions">
        {DECISION_NOTICE}
      </p>
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
