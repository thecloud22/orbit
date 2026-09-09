import { Fragment, useCallback, useEffect, useState } from 'react';

import type { RecoveryProposalView, SopBindingsView, SopReviewView } from '@orbit/api/views';

import {
  answerSopQuestion,
  ApiRequestError,
  declareSopInput,
  editSopStep,
  acceptRecoveryProposal,
  dismissRecoveryProposal,
  getRecoveryProposals,
  getSopBindings,
  getSopReview,
  insertSopStep,
  publishBoundDocument,
  publishRecording,
  rejectCandidate,
  reorderSopStep,
  reviseSopDocument,
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
import { SopCallBindingPanel } from './SopCallBindingPanel';
import { SopInputsPanel } from './SopInputsPanel';
import { SopOutputsPanel } from './SopOutputsPanel';
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
  issuesWithoutRecovery,
  publishBlockedReason,
  reviewLead,
  reviewPhase,
  reviewProgress,
  reviseConfirmation,
  revisionHeadline,
  undeclaredInputRefs,
  type ReviewFailure,
  type ReviewLead,
  type ReviewProgressStep,
  type ReviseConfirmation,
} from './sop-review-view-model';
import { draftExecutabilityNotice } from './sop-draft-view-model';

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
  const [isRejectingCandidate, setIsRejectingCandidate] = useState(false);
  const [isStartingBinding, setIsStartingBinding] = useState(false);
  const [bindingFailure, setBindingFailure] = useState<BindingFailure | null>(null);
  const [startUrl, setStartUrl] = useState<string | null>(null);
  const [isStartingWalkthrough, setIsStartingWalkthrough] = useState(false);
  /** The "are you sure" step in front of revising (ADR-036). */
  const [isConfirmingRevise, setIsConfirmingRevise] = useState(false);
  /**
   * Whether the authoring surfaces are open on a published document.
   *
   * Collapsed by default there, and opened only by somebody asking for it —
   * including by revising, which is a person saying in as many words that this
   * is what they came to do.
   */
  const [areAuthoringSurfacesOpen, setAreAuthoringSurfacesOpen] = useState(false);

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
  /**
   * Saves the typed start URL into the workflow's own `navigate` step.
   *
   * Only reachable while the revision is still editable (ADR-017) — the
   * button that calls this is withheld otherwise, but the check is repeated
   * here so a stale click from before the revision closed cannot slip through.
   */
  function saveStartUrl() {
    if (review === null || startUrl === null || !review.editable) {
      return;
    }

    const navigateStep = review.steps.find((step) => step.kind === 'navigate');

    if (navigateStep === undefined) {
      return;
    }

    void act(() =>
      editSopStep(review.revisionId, navigateStep.id, {
        ...navigateStep.step,
        urlHint: startUrl,
      }),
    );
  }

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
        existingSessionId: described.existingSessionId,
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

  // One derived phase, and the layout follows from it rather than from each
  // section deciding for itself whether it is relevant (ADR-036).
  const phase = reviewPhase(review, bindings);
  const lead = reviewLead(review, bindings);

  /**
   * Published, but this revision is not what was published.
   *
   * The state revising produces, and the reason Publish has to come back: a
   * document that has moved on since its version was compiled has a real action
   * in front of it, and burying that under a collapsed section would make the
   * fork a dead end.
   */
  const hasUnpublishedRevision =
    review.publication.agentVersionId !== null &&
    review.publication.compiledFromRevisionId !== review.revisionId;

  const collapsesAuthoring = phase === 'published' && !hasUnpublishedRevision;

  const publishPanel = (
    <SopPublishPanel
      declaredOutcomes={review.declaredOutcomes}
      fullyBound={isFullyBoundForPublish(bindings)}
      isPublishing={isPublishingRecording}
      isRejecting={isRejectingCandidate}
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
      onReject={() => {
        const candidateId = review.publication.candidateId;
        if (candidateId === null) {
          return;
        }

        setIsRejectingCandidate(true);
        setFailure(null);

        void rejectCandidate(candidateId)
          .then(() => load())
          .catch((caught: unknown) => {
            setFailure(
              describeReviewFailure(
                caught instanceof ApiRequestError
                  ? caught
                  : new ApiRequestError({ status: 0, message: 'The API could not be reached.' }),
              ),
            );
          })
          .finally(() => {
            setIsRejectingCandidate(false);
          });
      }}
      provenanceKind={review.provenance.kind}
      publication={review.publication}
      publishFailure={publishRecordingFailure}
      revisionId={review.revisionId}
    />
  );

  // The server already refuses to open a browser with nothing to bind
  // (`nothing_to_bind`) — a window somebody has to close for no reason.
  // Offering the button anyway just meant clicking it to be told that, so the
  // offer is withheld here on the same fact the server checks.
  const walkthroughOffer =
    walkthroughSessionId === null && !isFullyBoundForPublish(bindings) ? (
      <StartWalkthrough
        disabled={busy || bindingSessionId !== null}
        isStarting={isStartingWalkthrough}
        onStart={() => void startWholeWorkflow()}
      />
    ) : undefined;

  const authoring = (
    <>
      <SopInputsPanel
        editable={review.editable}
        inputs={review.inputs}
        onSaved={() => void load()}
        revisionId={review.revisionId}
      />

      <SopOutputsPanel
        editable={review.editable}
        onSaved={() => void load()}
        outputs={review.outputs}
        revisionId={review.revisionId}
      />

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

      <SopBindingPanel
        bindings={bindings}
        isStarting={isStartingBinding}
        onBind={(stepId) => void bindStep(stepId)}
        onAcceptProposal={(proposalId) => void resolveProposal(proposalId, 'accept')}
        onDismissProposal={(proposalId) => void resolveProposal(proposalId, 'dismiss')}
        onSaveStartUrl={saveStartUrl}
        onStartUrlChange={setStartUrl}
        proposals={proposals}
        resolvingProposalId={resolvingProposalId}
        startUrl={bindingSessionId === null ? (startUrl ?? '') : null}
        startUrlEditable={review.editable}
        steps={review.steps}
        walkthrough={walkthroughOffer}
      />

      <SopCallBindingPanel
        bindings={bindings}
        declaredInputs={review.inputs}
        documentId={documentId}
        onSaved={() => void load()}
        steps={review.steps}
      />

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
    </>
  );

  return (
    <section className="flex flex-col gap-4" data-testid="sop-review">
      <header className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p
          className="rounded bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900"
          data-testid="sop-review-not-executable"
        >
          {draftExecutabilityNotice(review.publication.agentVersion)}
        </p>

        <h2 className="mt-3 text-base font-semibold text-slate-900" data-testid="sop-review-title">
          {review.title}
        </h2>
        <p className="text-xs text-slate-500" data-testid="sop-review-state">
          {revisionHeadline(review)}
        </p>

        <ReviewProgress steps={reviewProgress(review, bindings)} />

        {blocked !== null && (
          <p className="mt-2 text-xs text-amber-900" data-testid="sop-publish-blocked">
            {blocked}
          </p>
        )}
      </header>

      {failure !== null && (
        <FailureNotice
          failure={failure}
          onRecovered={() => {
            setFailure(null);
            void load();
          }}
          revisionId={review.revisionId}
        />
      )}

      {/*
        Skipped for `ready`, not just demoted: `onOpenAgent` and `revise` are
        both always undefined in that phase anyway (neither an agent version
        nor a non-editable revision exists yet), so the card would carry
        nothing but the "Ready to publish" title and body this phase is being
        kept from leading with. The plain title and revision state in the
        header above already says what phase this is.
      */}
      {phase !== 'ready' && (
        <ReviewLeadCard
          lead={lead}
          onOpenAgent={
            review.publication.agentVersionId === null
              ? undefined
              : () => {
                  onOpenAgent(review.publication.agentVersionId!);
                }
          }
          revise={
            // Offered only where there is something to fork. An editable
            // revision is already the thing Revise would create, and the
            // server refuses it as `already_editable` for exactly that reason.
            review.editable
              ? undefined
              : {
                  busy,
                  confirmation: reviseConfirmation(review),
                  isConfirming: isConfirmingRevise,
                  onCancel: () => setIsConfirmingRevise(false),
                  onConfirm: () => {
                    setIsConfirmingRevise(false);
                    // Opened because somebody asked for it, which is the one
                    // thing that overrides "collapsed by default".
                    setAreAuthoringSurfacesOpen(true);
                    void act(() => reviseSopDocument(documentId));
                  },
                  onStart: () => setIsConfirmingRevise(true),
                }
          }
        />
      )}

      {/*
        One fixed position, always -- not something that leads the page in one
        state and hides among the steps in another. Editing a step used to
        bring this back to the top of the page each time, which read as "you
        just finished one edit, publish now?" on every single save. Publishing
        is a decision made once, when a person is done with however many edits
        they meant to make; `SopPublishPanel` already says plainly whether
        there is anything to publish right now (`publicationStage`), so moving
        it around based on phase was never required for that to be clear.
      */}
      {publishPanel}

      {bindingFailure !== null && (
        <section
          className="rounded border border-rose-300 bg-rose-50 p-4"
          data-testid="binding-start-failure"
        >
          <h3 className="text-sm font-semibold text-rose-900">{bindingFailure.title}</h3>
          <p className="mt-1 text-sm text-rose-900">{bindingFailure.message}</p>
        </section>
      )}

      {/*
        The two live workspaces stay at the top level, outside anything that
        collapses. Each holds a real Chromium open on the machine running the
        API, and a window a person cannot see is a window they cannot close.
      */}
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

      {walkthroughSessionId !== null && (
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

      {collapsesAuthoring ? (
        <details
          className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
          data-testid="sop-authoring-surfaces"
          onToggle={(event) => setAreAuthoringSurfacesOpen(event.currentTarget.open)}
          open={areAuthoringSurfacesOpen}
        >
          <summary
            className="cursor-pointer text-sm font-semibold text-slate-900 hover:text-indigo-700"
            data-testid="sop-authoring-surfaces-summary"
          >
            Build a new version — steps, page mappings and publishing
          </summary>
          <p className="mt-1 text-xs text-slate-500">
            Everything in here builds toward a <em>new</em> version. Re-mapping a step that has
            moved on the page needs nothing else; changing what a step <em>does</em> needs a new
            revision first.
          </p>
          <div className="mt-4 flex flex-col gap-4">{authoring}</div>
        </details>
      ) : (
        <div className="flex flex-col gap-4" data-testid="sop-authoring-surfaces">
          {authoring}
        </div>
      )}
    </section>
  );
}

/**
 * Where this revision sits along Draft -> Ready to publish -> Published.
 *
 * Shown unconditionally, unlike the lead card below (which the `ready` phase
 * deliberately skips so it does not repeat the header). A person who has just
 * finished recording or a walkthrough otherwise lands on a page with no signal
 * that anything is actually finished; this is the thing that says so at a
 * glance, before they read a word of the steps list.
 */
function ReviewProgress({ steps }: { readonly steps: readonly ReviewProgressStep[] }) {
  return (
    <ol className="mt-3 flex items-center" data-testid="sop-review-progress">
      {steps.map((step, index) => (
        <Fragment key={step.phase}>
          {index > 0 && (
            <span
              aria-hidden="true"
              className={`h-px flex-1 ${step.status === 'upcoming' ? 'bg-slate-200' : 'bg-indigo-400'}`}
            />
          )}
          <li
            className="flex items-center gap-1.5 whitespace-nowrap px-1 text-xs font-medium"
            data-status={step.status}
            data-testid={`sop-review-progress-step-${step.phase}`}
          >
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${
                step.status === 'done'
                  ? 'bg-indigo-600 text-white'
                  : step.status === 'current'
                    ? 'border-2 border-indigo-600 text-indigo-700'
                    : 'border border-slate-300 text-slate-400'
              }`}
            >
              {step.status === 'done' ? '✓' : index + 1}
            </span>
            <span className={step.status === 'upcoming' ? 'text-slate-400' : 'text-slate-900'}>
              {step.label}
            </span>
          </li>
        </Fragment>
      ))}
    </ol>
  );
}

/**
 * The one thing this workflow is about right now.
 *
 * A published document leads with what is running and the way back to editing;
 * a ready one leads with the action; a drafting one leads with what is missing.
 * Before ADR-036 there was no lead at all — every section announced itself, and
 * a finished workflow offered three next steps where the answer was none.
 */
function ReviewLeadCard({
  lead,
  onOpenAgent,
  revise,
}: {
  readonly lead: ReviewLead;
  readonly onOpenAgent: (() => void) | undefined;
  readonly revise:
    | {
        readonly confirmation: ReviseConfirmation;
        readonly isConfirming: boolean;
        readonly busy: boolean;
        readonly onStart: () => void;
        readonly onConfirm: () => void;
        readonly onCancel: () => void;
      }
    | undefined;
}) {
  const tone =
    lead.phase === 'published'
      ? 'border-indigo-200 bg-indigo-50/60'
      : lead.phase === 'ready'
        ? 'border-emerald-200 bg-emerald-50/60'
        : 'border-slate-200 bg-white';

  return (
    <section
      className={`rounded-lg border p-5 shadow-sm ${tone}`}
      data-testid={`sop-review-lead-${lead.phase}`}
    >
      <h3 className="text-sm font-semibold text-slate-900" data-testid="sop-review-lead-title">
        {lead.title}
      </h3>
      <p className="mt-1 text-sm text-slate-700" data-testid="sop-review-lead-body">
        {lead.body}
      </p>

      {(onOpenAgent !== undefined || revise !== undefined) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {onOpenAgent !== undefined && (
            <button
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-900 transition-colors hover:border-slate-400"
              data-testid="open-published-agent"
              onClick={onOpenAgent}
              type="button"
            >
              Open the published agent →
            </button>
          )}

          {revise !== undefined && !revise.isConfirming && (
            <button
              className="rounded-md border border-indigo-300 bg-white px-3 py-1.5 text-sm font-medium text-indigo-700 transition-colors hover:border-indigo-400 hover:bg-indigo-50 disabled:text-slate-400"
              data-testid="sop-revise-start"
              disabled={revise.busy}
              onClick={revise.onStart}
              type="button"
            >
              Revise this workflow
            </button>
          )}
        </div>
      )}

      {/*
        Asked before it is done, because the three things a reasonable person
        fears here are all false and none of them is visible from the button.
      */}
      {revise !== undefined && revise.isConfirming && (
        <div
          className="mt-3 rounded-md border border-indigo-300 bg-white p-3"
          data-testid="sop-revise-confirm"
        >
          <p className="text-sm font-semibold text-slate-900">{revise.confirmation.title}</p>
          <ul
            className="mt-2 list-disc pl-5 text-xs text-slate-700"
            data-testid="sop-revise-confirm-points"
          >
            {revise.confirmation.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <button
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:bg-slate-300"
              data-testid="sop-revise-confirm-button"
              disabled={revise.busy}
              onClick={revise.onConfirm}
              type="button"
            >
              {revise.confirmation.confirmLabel}
            </button>
            <button
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400"
              data-testid="sop-revise-cancel"
              onClick={revise.onCancel}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * The offer to bind everything at once (ADR-035).
 *
 * Rendered inside the binding panel rather than beside it. As a top-level
 * section it read as a fourth piece of work competing with "What each step does
 * on the page", when it is the fast route to the same outcome — and the two
 * being adjacent is what made the review page confusing to a person who had
 * just published something (ADR-036).
 *
 * The per-step flow underneath is unchanged and must not read as replaced.
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

/**
 * A failed edit, and a way to fix it on the spot where one exists.
 *
 * `revisionId`/`onRecovered` are optional because this is also shown before a
 * revision has loaded at all (an initial fetch failure has nothing to recover
 * into) -- see the earlier `review === null` render. Everywhere `review` is
 * loaded, both are passed, and the one recoverable case this page knows about
 * gets its own fix instead of a code and a JSON path.
 */
function FailureNotice({
  failure,
  revisionId,
  onRecovered,
}: {
  readonly failure: ReviewFailure;
  readonly revisionId?: string;
  readonly onRecovered?: () => void;
}) {
  const missingInputs = undeclaredInputRefs(failure);
  const remainingIssues = issuesWithoutRecovery(failure);

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

      {revisionId !== undefined &&
        onRecovered !== undefined &&
        missingInputs.map((name) => (
          <UndeclaredInputFix
            inputId={name}
            key={name}
            onRecovered={onRecovered}
            revisionId={revisionId}
          />
        ))}

      {remainingIssues.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-rose-900" data-testid="sop-review-issues">
          {remainingIssues.map((issue) => (
            <li key={`${issue.where}:${issue.message}`}>
              <span className="font-medium">{issue.where}</span>: {issue.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The fix for the one failure this page has hit repeatedly: a step's value
 * names a run input nobody declared yet.
 *
 * Says what is actually true in plain language, pre-fills the exact name the
 * failed edit already named (removing the one place a person could retype it
 * wrong), and reloads on success so the step's current text is what they see
 * next -- still there, ready to save again. This does not resubmit the edit
 * itself: the value the person typed only exists in the step editor's own open
 * form, and reaching into another component's state to resend it is more
 * surprising than asking for one more click on a save button they can already
 * see.
 */
function UndeclaredInputFix({
  inputId,
  revisionId,
  onRecovered,
}: {
  readonly inputId: string;
  readonly revisionId: string;
  readonly onRecovered: () => void;
}) {
  const [label, setLabel] = useState(inputId);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  function declare() {
    setIsSaving(true);
    setError(null);

    declareSopInput(revisionId, { id: inputId, label, required: true })
      .then(() => {
        onRecovered();
      })
      .catch((cause: unknown) => {
        setError(
          cause instanceof ApiRequestError
            ? cause
            : new ApiRequestError({ status: 0, message: 'The API could not be reached.' }),
        );
      })
      .finally(() => {
        setIsSaving(false);
      });
  }

  return (
    <div
      className="mt-3 rounded-md border border-rose-200 bg-white p-3"
      data-testid={`undeclared-input-fix-${inputId}`}
    >
      <p className="text-sm text-slate-900">
        This step uses{' '}
        <code className="font-mono text-xs">
          ${'{inputs.'}
          {inputId}
          {'}'}
        </code>
        , an input this workflow has not declared yet.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="text-xs text-slate-600" htmlFor={`undeclared-input-label-${inputId}`}>
          Label for it
        </label>
        <input
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          data-testid={`undeclared-input-label-${inputId}`}
          id={`undeclared-input-label-${inputId}`}
          onChange={(event) => {
            setLabel(event.target.value);
          }}
          value={label}
        />
        <button
          className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          data-testid={`undeclared-input-declare-${inputId}`}
          disabled={isSaving}
          onClick={declare}
          type="button"
        >
          {isSaving ? 'Declaring…' : 'Declare it'}
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        After this, open the step again and save it once more — what you typed is still there.
      </p>
      {error !== null && <p className="mt-1 text-xs text-rose-900">{error.message}</p>}
    </div>
  );
}
