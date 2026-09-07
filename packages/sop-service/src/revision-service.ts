import type { SopDocumentId, SopRevisionId } from '@orbit/contracts';
import {
  InvalidRunTransitionError,
  isUniqueViolation,
  RecordNotFoundError,
  SOP_REVISION_TRANSITIONS,
  violatedConstraint,
  withTransaction,
  type OrbitDatabase,
  type SopClarificationAnswerRecord,
  type SopDocumentRecord,
  type SopGraphRevisionRecord,
  type SopRevisionState,
} from '@orbit/db';
import type { createRepositories } from '@orbit/db';
import {
  parseSopGraphDocument,
  ReorderError,
  validateReorder,
  type ReorderMove,
  type SopGraph,
  type SopGraphIssue,
  type SopStep,
} from '@orbit/sop-graph';

/**
 * Reviewing a revision: reading it, editing it, reordering it, answering what
 * the model asked, and moving it through its lifecycle.
 *
 * Every rule here delegates. Validation is `parseSopGraphDocument`, reorder
 * legality is `validateReorder`, the transition table is
 * `SOP_REVISION_TRANSITIONS`, and superseding a parent is what
 * `sopGraphRevisions.create` already does in one transaction. This module owns
 * only the two product rules recorded in ADR-017 — which revisions may be
 * edited, and what must be answered before review — because neither is a
 * statement about which transitions exist.
 */

/**
 * The states a revision may still be changed in.
 *
 * `SOP_REVISION_TRANSITIONS` permits any state to be superseded, so nothing
 * structural stops an edit quietly un-approving an approved document. A
 * reviewer looking at an `in_review` revision who spots a problem moves it back
 * with `request_clarification` first — which is exactly what that transition is
 * for. See ADR-017.
 */
export const EDITABLE_REVISION_STATES: readonly SopRevisionState[] = [
  'draft',
  'needs_clarification',
];

export function isEditableState(state: SopRevisionState): boolean {
  return EDITABLE_REVISION_STATES.includes(state);
}

export const SOP_REVISION_ACTIONS = [
  'request_clarification',
  'submit_for_review',
  'approve',
  'reject',
] as const;

export type SopRevisionAction = (typeof SOP_REVISION_ACTIONS)[number];

/**
 * What each action asks the revision to become.
 *
 * `superseded` is deliberately not here: it is a consequence of editing, not
 * something a person chooses, so it can never appear as an offered action.
 */
const ACTION_TARGET: Readonly<Record<SopRevisionAction, SopRevisionState>> = {
  request_clarification: 'needs_clarification',
  submit_for_review: 'in_review',
  approve: 'approved',
  reject: 'rejected',
};

export interface ClarificationEntry {
  readonly questionId: string;
  readonly question: string;
  readonly aboutStepId: string | null;
  readonly options: readonly string[] | null;
  readonly answer: string | null;
  readonly answeredAt: Date | null;
}

/**
 * Where this document has got to on the way to being runnable.
 *
 * Read-only, and deliberately so: the review page needs to know whether there
 * is an approved candidate to publish and whether an agent already exists, so
 * it can offer the action and then link out. It does not need — and must not
 * gain — any notion that the document itself became executable. The SOP Graph
 * is non-executable by construction and stays that way after publishing
 * (ADR-016); the runnable artifact is a different row entirely.
 */
export interface PublicationStatus {
  /** The newest candidate for this document, if one has been compiled. */
  readonly candidateId: string | null;
  readonly candidateState: string | null;
  /** Whether that candidate could be checked; `cannot_validate` blocks approval. */
  readonly sandboxState: string | null;
  /** Set once the candidate has been published. */
  readonly agentVersionId: string | null;
  readonly agentVersion: string | null;
}

export interface RevisionReview {
  readonly document: SopDocumentRecord;
  readonly revision: SopGraphRevisionRecord;
  readonly clarifications: readonly ClarificationEntry[];
  readonly unansweredQuestionIds: readonly string[];
  readonly availableActions: readonly SopRevisionAction[];
  readonly editable: boolean;
  readonly publication: PublicationStatus;
}

/**
 * The actions legal from a state, computed from the transition table.
 *
 * Derived rather than listed, so the offered actions cannot drift from what the
 * repository will actually accept. The §4 gate then removes one of them; the
 * gate is applied again at the transition itself, because hiding a button is
 * never what makes a rule hold.
 */
export function availableActionsFor(
  state: SopRevisionState,
  unansweredQuestionCount: number,
): readonly SopRevisionAction[] {
  const targets = SOP_REVISION_TRANSITIONS[state];

  return SOP_REVISION_ACTIONS.filter((action) => targets.includes(ACTION_TARGET[action])).filter(
    (action) => !(action === 'submit_for_review' && unansweredQuestionCount > 0),
  );
}

export type GetReviewResult =
  | { readonly ok: true; readonly review: RevisionReview }
  | { readonly ok: false; readonly reason: 'not_found' };

export type EditStepResult =
  | { readonly ok: true; readonly revision: SopGraphRevisionRecord }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'not_editable'; readonly state: SopRevisionState }
  | { readonly ok: false; readonly reason: 'unknown_step'; readonly stepId: string }
  | { readonly ok: false; readonly reason: 'step_id_immutable'; readonly stepId: string }
  | {
      readonly ok: false;
      readonly reason: 'invalid_graph';
      readonly issues: readonly SopGraphIssue[];
    };

export type ReorderResultOfRevision =
  | { readonly ok: true; readonly revision: SopGraphRevisionRecord }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'not_editable'; readonly state: SopRevisionState }
  | { readonly ok: false; readonly reason: 'out_of_range'; readonly explanation: string }
  | {
      readonly ok: false;
      readonly reason: 'rejected';
      readonly explanation: string;
      readonly issues: readonly SopGraphIssue[];
    };

export type AnswerQuestionResult =
  | { readonly ok: true; readonly answer: SopClarificationAnswerRecord }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'not_editable'; readonly state: SopRevisionState }
  | { readonly ok: false; readonly reason: 'unknown_question'; readonly questionId: string }
  | { readonly ok: false; readonly reason: 'already_answered'; readonly questionId: string };

export type TransitionResult =
  | { readonly ok: true; readonly revision: SopGraphRevisionRecord }
  | { readonly ok: false; readonly reason: 'not_found' }
  | {
      readonly ok: false;
      readonly reason: 'illegal_transition';
      readonly from: SopRevisionState;
      readonly action: SopRevisionAction;
    }
  | {
      readonly ok: false;
      readonly reason: 'questions_unanswered';
      readonly unansweredQuestionIds: readonly string[];
    };

export interface SopRevisionService {
  reviewDocument(documentId: SopDocumentId): Promise<GetReviewResult>;
  reviewRevision(revisionId: SopRevisionId): Promise<GetReviewResult>;
  editStep(input: {
    readonly revisionId: SopRevisionId;
    readonly stepId: string;
    readonly step: SopStep;
    readonly note?: string;
  }): Promise<EditStepResult>;
  reorderStep(input: {
    readonly revisionId: SopRevisionId;
    readonly move: ReorderMove;
    readonly note?: string;
  }): Promise<ReorderResultOfRevision>;
  answerQuestion(input: {
    readonly revisionId: SopRevisionId;
    readonly questionId: string;
    readonly answer: string;
  }): Promise<AnswerQuestionResult>;
  transition(input: {
    readonly revisionId: SopRevisionId;
    readonly action: SopRevisionAction;
    readonly note?: string;
  }): Promise<TransitionResult>;
}

export interface SopRevisionServiceOptions {
  readonly database: OrbitDatabase;
}

const ANSWER_UNIQUE_CONSTRAINT = 'sop_clarification_answers_revision_question_unique';

function unansweredQuestionIds(
  graph: SopGraph,
  answers: readonly SopClarificationAnswerRecord[],
): readonly string[] {
  const answered = new Set(answers.map((answer) => answer.questionId));
  return graph.clarificationQuestions
    .filter((question) => !answered.has(question.id))
    .map((question) => question.id);
}

/**
 * The publication state of a document, assembled from what already exists.
 *
 * No new persistence: the candidate chain and the agent version rows are
 * already the record, and this only reads them so the review page can offer an
 * action and then link out.
 */
async function publicationStatusFor(
  repositories: ReturnType<typeof createRepositories>,
  documentId: SopDocumentId,
): Promise<PublicationStatus> {
  const candidate = await repositories.agentIrCandidates.findCurrent(documentId);

  if (candidate === null) {
    return {
      candidateId: null,
      candidateState: null,
      sandboxState: null,
      agentVersionId: null,
      agentVersion: null,
    };
  }

  const published = (
    await repositories.agentVersions.listByAgent(candidate.agentIr.id as never)
  ).find((version) => version.publishedFromCandidateId === candidate.id);

  return {
    candidateId: candidate.id,
    candidateState: candidate.state,
    sandboxState: candidate.sandboxState,
    agentVersionId: published?.id ?? null,
    agentVersion: published?.version ?? null,
  };
}

function toClarifications(
  graph: SopGraph,
  answers: readonly SopClarificationAnswerRecord[],
): readonly ClarificationEntry[] {
  const byQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));

  return graph.clarificationQuestions.map((question) => {
    const answer = byQuestion.get(question.id);

    return {
      questionId: question.id,
      question: question.question,
      aboutStepId: question.aboutStepId ?? null,
      options: question.options ?? null,
      answer: answer?.answer ?? null,
      answeredAt: answer?.answeredAt ?? null,
    };
  });
}

export function createSopRevisionService(options: SopRevisionServiceOptions): SopRevisionService {
  const { database } = options;

  /** Builds a new revision from an edited graph, superseding the one edited. */
  async function supersedeWith(
    repositories: Parameters<Parameters<typeof withTransaction>[1]>[0],
    previous: SopGraphRevisionRecord,
    graph: SopGraph,
    note: string | undefined,
  ): Promise<SopGraphRevisionRecord> {
    return repositories.sopGraphRevisions.create({
      documentId: previous.documentId,
      graph,
      provenance: { kind: 'edited', ...(note === undefined ? {} : { note }) },
      parentRevisionId: previous.id,
    });
  }

  return {
    async reviewDocument(documentId) {
      return withTransaction(database, async (repositories) => {
        const document = await repositories.sopDocuments.findById(documentId);

        if (document === null) {
          return { ok: false, reason: 'not_found' };
        }

        const revision = await repositories.sopGraphRevisions.findCurrent(documentId);

        if (revision === null) {
          return { ok: false, reason: 'not_found' };
        }

        const answers = await repositories.sopGraphRevisions.listAnswers(revision.id);
        const unanswered = unansweredQuestionIds(revision.graph, answers);

        return {
          ok: true,
          review: {
            document,
            revision,
            clarifications: toClarifications(revision.graph, answers),
            unansweredQuestionIds: unanswered,
            availableActions: availableActionsFor(revision.state, unanswered.length),
            editable: isEditableState(revision.state),
            publication: await publicationStatusFor(repositories, documentId),
          },
        };
      });
    },

    async reviewRevision(revisionId) {
      return withTransaction(database, async (repositories) => {
        const revision = await repositories.sopGraphRevisions.findById(revisionId);

        if (revision === null) {
          return { ok: false, reason: 'not_found' };
        }

        const document = await repositories.sopDocuments.findById(revision.documentId);

        if (document === null) {
          return { ok: false, reason: 'not_found' };
        }

        const answers = await repositories.sopGraphRevisions.listAnswers(revision.id);
        const unanswered = unansweredQuestionIds(revision.graph, answers);

        return {
          ok: true,
          review: {
            document,
            revision,
            clarifications: toClarifications(revision.graph, answers),
            unansweredQuestionIds: unanswered,
            availableActions: availableActionsFor(revision.state, unanswered.length),
            editable: isEditableState(revision.state),
            publication: await publicationStatusFor(repositories, revision.documentId),
          },
        };
      });
    },

    async editStep(input) {
      return withTransaction(database, async (repositories) => {
        const revision = await repositories.sopGraphRevisions.findById(input.revisionId);

        if (revision === null) {
          return { ok: false, reason: 'not_found' };
        }

        if (!isEditableState(revision.state)) {
          return { ok: false, reason: 'not_editable', state: revision.state };
        }

        // Step ids are how branches name their targets, so renaming one from the
        // step editor would silently rewrite the graph's wiring. Ids are fixed
        // for this sub-phase; a mismatch is refused rather than overridden, so
        // the caller learns its edit was not what it thought it was.
        if (input.step.id !== input.stepId) {
          return { ok: false, reason: 'step_id_immutable', stepId: input.stepId };
        }

        const index = revision.graph.steps.findIndex((step) => step.id === input.stepId);

        if (index === -1) {
          return { ok: false, reason: 'unknown_step', stepId: input.stepId };
        }

        const steps = [...revision.graph.steps];
        steps[index] = input.step;

        // The whole graph is re-validated, not just the step: an edit that is
        // locally fine can still break the workflow around it — a changed
        // `value` can read a variable produced later, a changed branch target can
        // strand a step.
        const parsed = parseSopGraphDocument({ ...revision.graph, steps });

        if (!parsed.ok) {
          return { ok: false, reason: 'invalid_graph', issues: parsed.issues };
        }

        return {
          ok: true,
          revision: await supersedeWith(repositories, revision, parsed.graph, input.note),
        };
      });
    },

    async reorderStep(input) {
      return withTransaction(database, async (repositories) => {
        const revision = await repositories.sopGraphRevisions.findById(input.revisionId);

        if (revision === null) {
          return { ok: false, reason: 'not_found' };
        }

        if (!isEditableState(revision.state)) {
          return { ok: false, reason: 'not_editable', state: revision.state };
        }

        let result;

        try {
          result = validateReorder(revision.graph, input.move);
        } catch (error) {
          // `validateReorder` is not total: `applyReorder` throws for an unknown
          // step or a move past either end of the list. The UI disables those
          // controls, but a request can still arrive, and its message is already
          // written for a reviewer to read.
          if (error instanceof ReorderError) {
            return { ok: false, reason: 'out_of_range', explanation: error.message };
          }
          throw error;
        }

        if (!result.ok) {
          return {
            ok: false,
            reason: 'rejected',
            explanation: result.explanation,
            issues: result.issues,
          };
        }

        // A reorder is an edit. Same supersede path, deliberately not special-cased.
        return {
          ok: true,
          revision: await supersedeWith(repositories, revision, result.graph, input.note),
        };
      });
    },

    async answerQuestion(input) {
      return withTransaction(database, async (repositories) => {
        const revision = await repositories.sopGraphRevisions.findById(input.revisionId);

        if (revision === null) {
          return { ok: false, reason: 'not_found' };
        }

        if (!isEditableState(revision.state)) {
          return { ok: false, reason: 'not_editable', state: revision.state };
        }

        const question = revision.graph.clarificationQuestions.find(
          (candidate) => candidate.id === input.questionId,
        );

        if (question === undefined) {
          return { ok: false, reason: 'unknown_question', questionId: input.questionId };
        }

        const existing = await repositories.sopGraphRevisions.listAnswers(revision.id);

        if (existing.some((answer) => answer.questionId === input.questionId)) {
          return { ok: false, reason: 'already_answered', questionId: input.questionId };
        }

        try {
          return {
            ok: true,
            answer: await repositories.sopGraphRevisions.recordAnswer({
              revisionId: revision.id,
              questionId: input.questionId,
              answer: input.answer,
            }),
          };
        } catch (error) {
          // The check above is a read, so a concurrent answer to the same
          // question can land between it and this insert. The unique constraint
          // is what actually enforces one answer per question; this turns its
          // violation into the same typed conflict the check produces, so the
          // race and the ordinary case are indistinguishable to a caller.
          //
          // Matched on the constraint name rather than a message substring: any
          // other violation is a real failure and must not be reported as a
          // duplicate answer.
          if (isUniqueViolation(error) && violatedConstraint(error) === ANSWER_UNIQUE_CONSTRAINT) {
            return { ok: false, reason: 'already_answered', questionId: input.questionId };
          }
          throw error;
        }
      });
    },

    async transition(input) {
      return withTransaction(database, async (repositories) => {
        const revision = await repositories.sopGraphRevisions.findById(input.revisionId);

        if (revision === null) {
          return { ok: false, reason: 'not_found' };
        }

        // The §4 rule, enforced here rather than only reflected in
        // `availableActionsFor`: an action is refused because the questions are
        // unanswered, not because a button was hidden. See ADR-017.
        if (input.action === 'submit_for_review') {
          const answers = await repositories.sopGraphRevisions.listAnswers(revision.id);
          const unanswered = unansweredQuestionIds(revision.graph, answers);

          if (unanswered.length > 0) {
            return { ok: false, reason: 'questions_unanswered', unansweredQuestionIds: unanswered };
          }
        }

        const note = input.note;

        try {
          switch (input.action) {
            case 'request_clarification':
              return {
                ok: true,
                revision: await repositories.sopGraphRevisions.requestClarification(revision.id),
              };
            case 'submit_for_review':
              return {
                ok: true,
                revision: await repositories.sopGraphRevisions.submitForReview(revision.id),
              };
            case 'approve':
              return {
                ok: true,
                revision: await repositories.sopGraphRevisions.approve(
                  revision.id,
                  note === undefined ? undefined : { reviewNote: note },
                ),
              };
            case 'reject':
              return {
                ok: true,
                revision: await repositories.sopGraphRevisions.reject(
                  revision.id,
                  note === undefined ? undefined : { reviewNote: note },
                ),
              };
          }
        } catch (error) {
          // Legality is decided by the repository's own `WHERE`-clause guard, not
          // by a second copy of the transition table here.
          if (error instanceof InvalidRunTransitionError) {
            return {
              ok: false,
              reason: 'illegal_transition',
              from: revision.state,
              action: input.action,
            };
          }
          if (error instanceof RecordNotFoundError) {
            return { ok: false, reason: 'not_found' };
          }
          throw error;
        }
      });
    },
  };
}
