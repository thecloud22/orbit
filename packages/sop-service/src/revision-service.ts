import type { SopDocumentId, SopRevisionId } from '@orbit/contracts';
import {
  InvalidRunTransitionError,
  isUniqueViolation,
  RecordNotFoundError,
  SOP_REVISION_TRANSITIONS,
  stepChecksum,
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
  generateStepId,
  parseSopGraphDocument,
  ReorderError,
  validateReorder,
  type ReorderMove,
  type SopGraph,
  type SopGraphIssue,
  type SopStep,
  type SopStepDraft,
} from '@orbit/sop-graph';

import { defaultValueSourceFor } from './binding-service';

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
  /**
   * The revision that candidate was compiled from.
   *
   * Read against the current revision id, this is how a caller tells "published,
   * and this is what is running" from "published, and there are changes since"
   * — the state a document lands in the moment somebody revises it (ADR-036).
   * Derived from the candidate row, which has always recorded it; nothing new
   * is persisted for this.
   */
  readonly compiledFromRevisionId: string | null;
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

export type DeclareInputResult =
  | { readonly ok: true; readonly revision: SopGraphRevisionRecord }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'not_editable'; readonly state: SopRevisionState }
  | { readonly ok: false; readonly reason: 'duplicate_input'; readonly inputId: string }
  | {
      readonly ok: false;
      readonly reason: 'invalid_graph';
      readonly issues: readonly SopGraphIssue[];
    };

export type DeclareOutputResult =
  | { readonly ok: true; readonly revision: SopGraphRevisionRecord }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'not_editable'; readonly state: SopRevisionState }
  | { readonly ok: false; readonly reason: 'duplicate_output'; readonly outputName: string }
  | {
      readonly ok: false;
      readonly reason: 'invalid_graph';
      readonly issues: readonly SopGraphIssue[];
    };

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

export type InsertStepResult =
  | { readonly ok: true; readonly revision: SopGraphRevisionRecord; readonly stepId: string }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'not_editable'; readonly state: SopRevisionState }
  | { readonly ok: false; readonly reason: 'out_of_range'; readonly explanation: string }
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

export type ReviseDocumentResult =
  | { readonly ok: true; readonly revision: SopGraphRevisionRecord }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'already_editable'; readonly state: SopRevisionState };

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
  /**
   * Declares a new run input on the workflow, as a new revision.
   *
   * The gap this closes: a recorded step captures whatever value a person
   * actually typed as a literal (a real member id, a real ISBN), and there was
   * no way afterward to turn that literal into something a run supplies. The
   * interpolation grammar already refuses `${inputs.x}` in a step's `value`
   * unless `x` is declared (ADR-007) -- this is the missing other half, adding
   * the declaration itself so a person can then reference it from the step
   * editor.
   *
   * String-only for now, matching the only input type Agent IR's compiler
   * actually carries through to a run (`SUPPORTED_VALUE_TYPES`). Widening to
   * other declared types is a real gap, not a design choice, and stays out of
   * scope until something needs one.
   */
  declareInput(input: {
    readonly revisionId: SopRevisionId;
    readonly id: string;
    readonly label: string;
    readonly required: boolean;
    readonly note?: string;
  }): Promise<DeclareInputResult>;
  /**
   * Declares a new run output on the workflow, as a new revision.
   *
   * The symmetric gap to `declareInput`: an outcome step's `returns` names a
   * variable a step produces, but the compiler also requires that name to
   * appear in the graph's own `outputs` declaration (it becomes
   * `agentIr.outputs`, and `complete.outputs` is checked against it there) --
   * and until this route existed there was no way to add one after the fact,
   * on any workflow that did not already have it from the drafting flow.
   *
   * Declaring an output nothing returns yet is accepted, the same as
   * `declareInput` accepts one nothing references yet: there is no
   * unused-output check, and a person finds out it went unused only when they
   * never end up writing it into an outcome's `returns`.
   */
  declareOutput(input: {
    readonly revisionId: SopRevisionId;
    readonly name: string;
    readonly label: string;
    readonly description?: string;
    readonly note?: string;
  }): Promise<DeclareOutputResult>;
  /**
   * Adds a step at a chosen position, as a new revision.
   *
   * The only way a recorded workflow can become a branching one. The recording
   * translator deliberately refuses to invent a branch nobody demonstrated, so
   * without this a `decision` step could only ever come from the drafting flow
   * or a fixture.
   */
  insertStep(input: {
    readonly revisionId: SopRevisionId;
    /** Where the step lands: 0 puts it first, `steps.length` puts it last. */
    readonly index: number;
    readonly step: SopStepDraft;
    readonly note?: string;
  }): Promise<InsertStepResult>;
  reorderStep(input: {
    readonly revisionId: SopRevisionId;
    readonly move: ReorderMove;
    readonly note?: string;
  }): Promise<ReorderResultOfRevision>;
  /**
   * Makes a finished workflow editable again, by forking it.
   *
   * `approved` is terminal but for supersession, and deliberately so: what
   * somebody approved has to keep meaning what it meant, and every published
   * Agent Version compiled from it is immutable (ADR-005, ADR-014). So this
   * does not reopen the revision on screen — it copies that revision's graph
   * into the *next* one, as a `draft`, and supersedes the parent in the same
   * transaction through the one `create` path every other edit already uses.
   *
   * The graph is copied byte for byte, which is what makes this cheap: a
   * binding is keyed by `(document, step)` and its staleness is a per-step
   * checksum (`stepChecksum`), never revision identity, so every existing
   * binding stays approved and fresh across the fork. Only a step somebody then
   * actually edits goes stale. See ADR-036.
   */
  reviseDocument(input: {
    readonly documentId: SopDocumentId;
    readonly note?: string;
  }): Promise<ReviseDocumentResult>;
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
      compiledFromRevisionId: null,
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
    compiledFromRevisionId: candidate.revisionId,
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

/**
 * Whether an edit to a `fill` step changed nothing but its value.
 *
 * Deliberately narrow, and deliberately not generalised to other step kinds.
 * A `fill` step's binding names an element (`fieldHint`) *and* carries a
 * `valueSource` derived from `value` at binding time (`defaultValueSourceFor`)
 * -- so a value-only edit does not leave the binding untouched, it leaves the
 * *element* untouched. The element is what a human had to point a browser at
 * to prove; the value source is a pure function of text already sitting in
 * the graph. Hashing the whole step for staleness is otherwise correct
 * (`stepChecksum`'s own contract, unchanged here), but it means turning a
 * recorded literal into a declared input -- the very capability sub-phase
 * 2.16 added -- always looked identical to changing which element the step
 * acts on, and always demanded the same fresh browser demonstration to fix.
 *
 * `click` and `extract` steps have no field like this to exclude, and a
 * `decision` binding covers several elements at once rather than one; both
 * are left to the ordinary whole-step check.
 */
export function isValueOnlyFillChange(previous: SopStep, next: SopStep): boolean {
  if (previous.kind !== 'fill' || next.kind !== 'fill') {
    return false;
  }

  return (
    previous.id === next.id &&
    previous.purpose === next.purpose &&
    previous.fieldHint === next.fieldHint &&
    (previous.sensitive ?? false) === (next.sensitive ?? false)
    // `value` is the one field this deliberately does not compare.
  );
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

        const previousStep = revision.graph.steps[index];
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

        const nextRevision = await supersedeWith(repositories, revision, parsed.graph, input.note);

        // Carries an approved binding forward when the only thing that changed
        // is a fill step's value -- the case that made declaring a run input
        // and then referencing it from a recorded step force a fresh browser
        // demonstration every time, for a reason that had nothing to do with
        // the element the binding names. See `isValueOnlyFillChange` for the
        // exact, narrow scope this covers and does not.
        if (previousStep !== undefined && isValueOnlyFillChange(previousStep, input.step)) {
          const current = await repositories.executionBindings.findCurrent(
            revision.documentId,
            input.stepId,
          );

          // Both conditions matter. `state === 'approved'` -- a draft or
          // rejected binding has no human confirmation to carry forward at
          // all. Matching `stepSha256` against the step *before this edit* --
          // not the one being saved now -- is what proves the approval this
          // binding already carries was given against exactly the content
          // this edit is about to replace, so nothing is being inferred about
          // a state nobody actually looked at.
          // `valueSource` is not element metadata -- it is what the runtime
          // actually types into the field, derived from `value` at binding
          // time (`defaultValueSourceFor`). Carrying it forward unchanged
          // would keep executing the *old* value (e.g. a recorded literal)
          // forever, silently, even though the graph now says something
          // else. Only `target` -- the element a human actually pointed a
          // browser at -- is untouched by this edit and safe to carry as-is.
          const nextValueSource =
            current !== null && current.binding.body.kind === 'fill'
              ? defaultValueSourceFor(input.step)
              : null;

          if (
            current !== null &&
            current.state === 'approved' &&
            current.binding.body.kind === 'fill' &&
            current.binding.stepSha256 === stepChecksum(previousStep) &&
            nextValueSource !== null
          ) {
            const carried = await repositories.executionBindings.create({
              documentId: revision.documentId,
              binding: {
                ...current.binding,
                body: { ...current.binding.body, valueSource: nextValueSource },
                stepSha256: stepChecksum(input.step),
                capturedAgainstRevisionId: nextRevision.id,
              },
              parentBindingId: current.id,
            });

            await repositories.executionBindings.submitForReview(carried.id);
            await repositories.executionBindings.approve(carried.id, {
              reviewNote:
                'Carried forward automatically: only the value changed. The element is unchanged from ' +
                'the approved demonstration; the value source was recomputed from the new value.',
            });
          }
        }

        return { ok: true, revision: nextRevision };
      });
    },

    async declareInput(input) {
      return withTransaction(database, async (repositories) => {
        const revision = await repositories.sopGraphRevisions.findById(input.revisionId);

        if (revision === null) {
          return { ok: false, reason: 'not_found' };
        }

        if (!isEditableState(revision.state)) {
          return { ok: false, reason: 'not_editable', state: revision.state };
        }

        if (revision.graph.inputs.some((declared) => declared.id === input.id)) {
          return { ok: false, reason: 'duplicate_input', inputId: input.id };
        }

        const inputs = [
          ...revision.graph.inputs,
          { id: input.id, type: 'string' as const, label: input.label, required: input.required },
        ];

        // Re-validated through the same path editStep uses, for consistency
        // rather than because this particular change is likely to fail it: an
        // added declaration cannot by itself break a graph that was already
        // valid, since nothing yet references it. Declaring an input that
        // nothing uses is accepted -- there is no unused-input check -- and a
        // person finds out it went unreferenced only if they never end up
        // writing `${inputs.<id>}` anywhere.
        const parsed = parseSopGraphDocument({ ...revision.graph, inputs });

        if (!parsed.ok) {
          return { ok: false, reason: 'invalid_graph', issues: parsed.issues };
        }

        return {
          ok: true,
          revision: await supersedeWith(repositories, revision, parsed.graph, input.note),
        };
      });
    },

    async declareOutput(input) {
      return withTransaction(database, async (repositories) => {
        const revision = await repositories.sopGraphRevisions.findById(input.revisionId);

        if (revision === null) {
          return { ok: false, reason: 'not_found' };
        }

        if (!isEditableState(revision.state)) {
          return { ok: false, reason: 'not_editable', state: revision.state };
        }

        if (revision.graph.outputs.some((declared) => declared.name === input.name)) {
          return { ok: false, reason: 'duplicate_output', outputName: input.name };
        }

        const outputs = [
          ...revision.graph.outputs,
          {
            name: input.name,
            label: input.label,
            ...(input.description === undefined ? {} : { description: input.description }),
          },
        ];

        const parsed = parseSopGraphDocument({ ...revision.graph, outputs });

        if (!parsed.ok) {
          return { ok: false, reason: 'invalid_graph', issues: parsed.issues };
        }

        return {
          ok: true,
          revision: await supersedeWith(repositories, revision, parsed.graph, input.note),
        };
      });
    },

    async insertStep(input) {
      return withTransaction(database, async (repositories) => {
        const revision = await repositories.sopGraphRevisions.findById(input.revisionId);

        if (revision === null) {
          return { ok: false, reason: 'not_found' };
        }

        if (!isEditableState(revision.state)) {
          return { ok: false, reason: 'not_editable', state: revision.state };
        }

        const previous = revision.graph.steps;

        // `steps.length` is a legal index: it means "put it at the end".
        if (!Number.isInteger(input.index) || input.index < 0 || input.index > previous.length) {
          return {
            ok: false,
            reason: 'out_of_range',
            explanation: `A step can be added anywhere from position 1 to ${String(previous.length + 1)}.`,
          };
        }

        // Generated, not supplied: see `generateStepId`. Uniqueness is checked
        // against the graph's own ids, so the result always satisfies the id
        // grammar and never collides with a branch target.
        const stepId = generateStepId(
          previous.map((step) => step.id),
          input.step.kind,
        );
        const step = { ...input.step, id: stepId } as SopStep;

        const steps = [...previous];
        steps.splice(input.index, 0, step);

        // The trap. `entryStepId` names the entry step explicitly rather than
        // meaning "whatever is first", so inserting in front of the entry step
        // without moving it leaves the new step silently unreachable and the
        // workflow still starting where it always did. The condition is the
        // index of the *entry step* rather than 0, because that — not the head
        // of the list — is the only position where fall-through puts the new
        // step before the workflow's current beginning.
        const entryIndex = previous.findIndex((entry) => entry.id === revision.graph.entryStepId);
        const entryStepId = input.index === entryIndex ? stepId : revision.graph.entryStepId;

        // The whole graph is re-validated, exactly as an edit is. An inserted
        // step can strand the step it displaced, read a value produced after
        // it, or leave a path that never reaches an outcome — none of which is
        // visible from the step alone.
        const parsed = parseSopGraphDocument({ ...revision.graph, entryStepId, steps });

        if (!parsed.ok) {
          return { ok: false, reason: 'invalid_graph', issues: parsed.issues };
        }

        return {
          ok: true,
          stepId,
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

    async reviseDocument(input) {
      return withTransaction(database, async (repositories) => {
        const document = await repositories.sopDocuments.findById(input.documentId);

        if (document === null) {
          return { ok: false, reason: 'not_found' };
        }

        const revision = await repositories.sopGraphRevisions.findCurrent(input.documentId);

        if (revision === null) {
          return { ok: false, reason: 'not_found' };
        }

        // Refused rather than silently forked. A revision that is already
        // `draft` or `needs_clarification` can just be edited, and forking it
        // would spend a revision number on a copy of itself and leave the
        // person wondering which of the two they are looking at.
        if (isEditableState(revision.state)) {
          return { ok: false, reason: 'already_editable', state: revision.state };
        }

        // The same graph, unchanged. Not a normalisation pass and not a
        // migration: `create` re-validates it, and any difference it introduced
        // would change a step's checksum and so stale a binding that had
        // nothing wrong with it.
        return {
          ok: true,
          revision: await supersedeWith(repositories, revision, revision.graph, input.note),
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
