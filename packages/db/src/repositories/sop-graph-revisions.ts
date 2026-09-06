import {
  newSopAnswerId,
  newSopRevisionId,
  type SopAnswerId,
  type SopDocumentId,
  type SopRevisionId,
} from '@orbit/contracts';
import { parseSopGraphDocument, type SopGraph } from '@orbit/sop-graph';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import { sha256Of } from '../checksum';
import type { Executor } from '../client';
import { InvalidRunTransitionError, OrbitDatabaseError, RecordNotFoundError } from '../errors';
import { toSopGraphRevisionRecord, type SopGraphRevisionRecord } from '../mappers';
import {
  sopClarificationAnswers,
  sopGraphRevisions,
  type SopRevisionProvenance,
  type SopRevisionState,
} from '../schema';

/** An invalid SOP Graph never becomes a revision. */
export class SopGraphValidationError extends OrbitDatabaseError {}

/**
 * The revision lifecycle.
 *
 * `draft` may go straight to `in_review` when there is nothing to ask;
 * `in_review` may fall back to `needs_clarification` when a reviewer raises a
 * new question. Anything may be superseded, because a new revision replaces
 * whatever came before it regardless of how far that one got. `superseded` is
 * terminal — a replaced revision is a historical record and never re-enters the
 * flow.
 */
export const SOP_REVISION_TRANSITIONS: Readonly<
  Record<SopRevisionState, readonly SopRevisionState[]>
> = {
  draft: ['needs_clarification', 'in_review', 'superseded'],
  needs_clarification: ['in_review', 'superseded'],
  in_review: ['approved', 'rejected', 'needs_clarification', 'superseded'],
  approved: ['superseded'],
  rejected: ['superseded'],
  superseded: [],
};

/** The states a transition into `target` may legally come from. */
export function statesAllowedToReach(target: SopRevisionState): readonly SopRevisionState[] {
  return (Object.keys(SOP_REVISION_TRANSITIONS) as SopRevisionState[]).filter((from) =>
    SOP_REVISION_TRANSITIONS[from].includes(target),
  );
}

export interface CreateSopRevisionInput {
  readonly documentId: SopDocumentId;
  /** Validated before anything is written; an invalid graph is never stored. */
  readonly graph: SopGraph;
  readonly provenance: SopRevisionProvenance;
  /** The revision this one was derived from. It is superseded in the same transaction. */
  readonly parentRevisionId?: SopRevisionId;
  readonly id?: SopRevisionId;
}

export interface ReviewSopRevisionInput {
  readonly reviewNote?: string;
  readonly reviewedAt?: Date;
}

export interface SopClarificationAnswerRecord {
  readonly id: SopAnswerId;
  readonly revisionId: SopRevisionId;
  readonly questionId: string;
  readonly answer: string;
  readonly answeredAt: Date;
}

/**
 * SOP graph revisions.
 *
 * There is no method that rewrites a stored graph, and that is the enforcement
 * of revision immutability: an edit creates the next revision and supersedes its
 * parent, so the chain is the edit history and an approved revision stays
 * exactly as it was approved.
 */
export interface SopGraphRevisionRepository {
  create(input: CreateSopRevisionInput): Promise<SopGraphRevisionRecord>;
  findById(id: SopRevisionId): Promise<SopGraphRevisionRecord | null>;
  listByDocument(documentId: SopDocumentId): Promise<readonly SopGraphRevisionRecord[]>;
  /** The newest revision that has not been superseded. */
  findCurrent(documentId: SopDocumentId): Promise<SopGraphRevisionRecord | null>;

  requestClarification(id: SopRevisionId): Promise<SopGraphRevisionRecord>;
  submitForReview(id: SopRevisionId): Promise<SopGraphRevisionRecord>;
  approve(id: SopRevisionId, input?: ReviewSopRevisionInput): Promise<SopGraphRevisionRecord>;
  reject(id: SopRevisionId, input?: ReviewSopRevisionInput): Promise<SopGraphRevisionRecord>;

  recordAnswer(input: {
    readonly revisionId: SopRevisionId;
    readonly questionId: string;
    readonly answer: string;
    readonly id?: SopAnswerId;
  }): Promise<SopClarificationAnswerRecord>;
  listAnswers(revisionId: SopRevisionId): Promise<readonly SopClarificationAnswerRecord[]>;
}

export function createSopGraphRevisionRepository(executor: Executor): SopGraphRevisionRepository {
  /**
   * Applies a state transition only from the states that permit it.
   *
   * The permitted states are part of the WHERE clause rather than a prior read,
   * so a concurrent writer cannot slip between the check and the write — the
   * same approach `runs.markRunning` already uses. Zero rows updated means the
   * transition was illegal, which raises: a rejected revision must never be
   * quietly moved back into review.
   */
  async function transition(
    id: SopRevisionId,
    target: SopRevisionState,
    set: Partial<typeof sopGraphRevisions.$inferInsert>,
  ): Promise<SopGraphRevisionRecord> {
    const from = statesAllowedToReach(target);

    const rows = await executor
      .update(sopGraphRevisions)
      .set({ ...set, state: target, updatedAt: new Date() })
      .where(and(eq(sopGraphRevisions.id, id), inArray(sopGraphRevisions.state, from)))
      .returning();

    const row = rows[0];

    if (row !== undefined) {
      return toSopGraphRevisionRecord(row);
    }

    const [existing] = await executor
      .select()
      .from(sopGraphRevisions)
      .where(eq(sopGraphRevisions.id, id))
      .limit(1);

    if (existing === undefined) {
      throw new RecordNotFoundError(`SOP graph revision ${id} does not exist.`);
    }

    throw new InvalidRunTransitionError(
      `Cannot move SOP graph revision ${id} to "${target}": it is "${existing.state}", and that transition is only allowed from ${from.join(', ')}.`,
    );
  }

  return {
    async create(input) {
      // Validated here, before anything is written, because Phase 2.2 will hand
      // this the output of a language model. Malformed or semantically invalid
      // output must never be persisted as a revision a human might later approve.
      const parsed = parseSopGraphDocument(input.graph);

      if (!parsed.ok) {
        throw new SopGraphValidationError(
          `Refusing to store an invalid SOP graph: ${JSON.stringify(parsed.issues, null, 2)}`,
        );
      }

      const document = { ...parsed.graph };

      return executor.transaction(async (tx) => {
        const [previous] = await tx
          .select({ number: sopGraphRevisions.revisionNumber })
          .from(sopGraphRevisions)
          .where(eq(sopGraphRevisions.documentId, input.documentId))
          .orderBy(desc(sopGraphRevisions.revisionNumber))
          .limit(1);

        const revisionNumber = (previous?.number ?? 0) + 1;
        const id = input.id ?? newSopRevisionId();

        const [row] = await tx
          .insert(sopGraphRevisions)
          .values({
            id,
            documentId: input.documentId,
            revisionNumber,
            graph: document,
            graphSha256: sha256Of(document),
            state: 'draft',
            provenance: input.provenance,
            parentRevisionId: input.parentRevisionId ?? null,
          })
          .returning();

        // Superseding the parent in the same transaction is what keeps "one
        // live revision per document" true rather than merely intended.
        if (input.parentRevisionId !== undefined) {
          await tx
            .update(sopGraphRevisions)
            .set({
              state: 'superseded',
              supersededByRevisionId: id,
              updatedAt: new Date(),
            })
            .where(eq(sopGraphRevisions.id, input.parentRevisionId));
        }

        return toSopGraphRevisionRecord(row!);
      });
    },

    async findById(id) {
      const [row] = await executor
        .select()
        .from(sopGraphRevisions)
        .where(eq(sopGraphRevisions.id, id))
        .limit(1);

      return row === undefined ? null : toSopGraphRevisionRecord(row);
    },

    async listByDocument(documentId) {
      const rows = await executor
        .select()
        .from(sopGraphRevisions)
        .where(eq(sopGraphRevisions.documentId, documentId))
        .orderBy(asc(sopGraphRevisions.revisionNumber));

      return rows.map(toSopGraphRevisionRecord);
    },

    async findCurrent(documentId) {
      const rows = await executor
        .select()
        .from(sopGraphRevisions)
        .where(eq(sopGraphRevisions.documentId, documentId))
        .orderBy(desc(sopGraphRevisions.revisionNumber));

      const current = rows.find((row) => row.state !== 'superseded');
      return current === undefined ? null : toSopGraphRevisionRecord(current);
    },

    async requestClarification(id) {
      return transition(id, 'needs_clarification', {});
    },

    async submitForReview(id) {
      return transition(id, 'in_review', {});
    },

    async approve(id, input) {
      return transition(id, 'approved', {
        reviewedAt: input?.reviewedAt ?? new Date(),
        reviewNote: input?.reviewNote ?? null,
      });
    },

    async reject(id, input) {
      return transition(id, 'rejected', {
        reviewedAt: input?.reviewedAt ?? new Date(),
        reviewNote: input?.reviewNote ?? null,
      });
    },

    async recordAnswer(input) {
      const [row] = await executor
        .insert(sopClarificationAnswers)
        .values({
          id: input.id ?? newSopAnswerId(),
          revisionId: input.revisionId,
          questionId: input.questionId,
          answer: input.answer,
        })
        .returning();

      return {
        id: row!.id,
        revisionId: row!.revisionId,
        questionId: row!.questionId,
        answer: row!.answer,
        answeredAt: row!.answeredAt,
      };
    },

    async listAnswers(revisionId) {
      const rows = await executor
        .select()
        .from(sopClarificationAnswers)
        .where(eq(sopClarificationAnswers.revisionId, revisionId))
        .orderBy(asc(sopClarificationAnswers.answeredAt), asc(sopClarificationAnswers.id));

      return rows.map((row) => ({
        id: row.id,
        revisionId: row.revisionId,
        questionId: row.questionId,
        answer: row.answer,
        answeredAt: row.answeredAt,
      }));
    },
  };
}
