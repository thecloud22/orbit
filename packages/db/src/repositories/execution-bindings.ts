import {
  newExecutionBindingId,
  type ExecutionBindingId,
  type SopDocumentId,
} from '@orbit/contracts';
import {
  BINDING_TRANSITIONS,
  parseExecutionBinding,
  statesAllowedToReach,
  type BindingState,
  type ExecutionBinding,
} from '@orbit/execution-mapping';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import { sha256Of } from '../checksum';
import type { Executor } from '../client';
import { InvalidRunTransitionError, OrbitDatabaseError, RecordNotFoundError } from '../errors';
import { toExecutionBindingRecord, type ExecutionBindingRecord } from '../mappers';
import { executionBindings } from '../schema';

/** An invalid binding never becomes a stored one. */
export class ExecutionBindingValidationError extends OrbitDatabaseError {}

export interface CreateExecutionBindingInput {
  readonly documentId: SopDocumentId;
  /** Validated before anything is written; an invalid binding is never stored. */
  readonly binding: ExecutionBinding;
  /** The binding this one replaces. It is superseded in the same transaction. */
  readonly parentBindingId?: ExecutionBindingId;
  readonly id?: ExecutionBindingId;
}

export interface ReviewExecutionBindingInput {
  readonly reviewNote?: string;
  readonly reviewedAt?: Date;
}

/**
 * Execution bindings.
 *
 * There is no method that rewrites a stored binding, which is the enforcement of
 * immutability: re-recording a step creates the next binding and supersedes its
 * parent, so the chain is the mapping history and an approved binding stays
 * exactly as it was approved.
 */
export interface ExecutionBindingRepository {
  create(input: CreateExecutionBindingInput): Promise<ExecutionBindingRecord>;
  findById(id: ExecutionBindingId): Promise<ExecutionBindingRecord | null>;
  listByDocument(documentId: SopDocumentId): Promise<readonly ExecutionBindingRecord[]>;
  /** The newest binding for a step that has not been superseded. */
  findCurrent(documentId: SopDocumentId, stepId: string): Promise<ExecutionBindingRecord | null>;
  /** Every step's current binding, which is what a run needs. */
  listCurrent(documentId: SopDocumentId): Promise<readonly ExecutionBindingRecord[]>;

  submitForReview(id: ExecutionBindingId): Promise<ExecutionBindingRecord>;
  returnToDraft(id: ExecutionBindingId): Promise<ExecutionBindingRecord>;
  approve(
    id: ExecutionBindingId,
    input?: ReviewExecutionBindingInput,
  ): Promise<ExecutionBindingRecord>;
  reject(
    id: ExecutionBindingId,
    input?: ReviewExecutionBindingInput,
  ): Promise<ExecutionBindingRecord>;
}

export function createExecutionBindingRepository(executor: Executor): ExecutionBindingRepository {
  /**
   * Applies a state transition only from the states that permit it.
   *
   * The permitted states are in the `WHERE` clause rather than a prior read, so
   * a concurrent writer cannot slip between the check and the write — the same
   * approach `runs.markRunning` and the SOP revision repository already use.
   */
  async function transition(
    id: ExecutionBindingId,
    target: BindingState,
    set: Partial<typeof executionBindings.$inferInsert>,
  ): Promise<ExecutionBindingRecord> {
    const from = statesAllowedToReach(target);

    const rows = await executor
      .update(executionBindings)
      .set({ ...set, state: target, updatedAt: new Date() })
      .where(and(eq(executionBindings.id, id), inArray(executionBindings.state, from)))
      .returning();

    const row = rows[0];

    if (row !== undefined) {
      return toExecutionBindingRecord(row);
    }

    const [existing] = await executor
      .select()
      .from(executionBindings)
      .where(eq(executionBindings.id, id))
      .limit(1);

    if (existing === undefined) {
      throw new RecordNotFoundError(`Execution binding ${id} does not exist.`);
    }

    throw new InvalidRunTransitionError(
      `Cannot move execution binding ${id} to "${target}": it is "${existing.state}", and that transition is only allowed from ${from.join(', ')}.`,
    );
  }

  return {
    async create(input) {
      // Validated here, before anything is written: a binding decides what a
      // real browser clicks, so a malformed one must never reach storage where
      // a human might later approve it.
      const parsed = parseExecutionBinding(input.binding);

      if (!parsed.ok) {
        throw new ExecutionBindingValidationError(
          `Refusing to store an invalid execution binding: ${JSON.stringify(parsed.issues, null, 2)}`,
        );
      }

      const document = { ...parsed.binding };

      return executor.transaction(async (tx) => {
        const [previous] = await tx
          .select({ number: executionBindings.bindingNumber })
          .from(executionBindings)
          .where(
            and(
              eq(executionBindings.documentId, input.documentId),
              eq(executionBindings.stepId, document.stepId),
            ),
          )
          .orderBy(desc(executionBindings.bindingNumber))
          .limit(1);

        const id = input.id ?? newExecutionBindingId();

        const [row] = await tx
          .insert(executionBindings)
          .values({
            id,
            documentId: input.documentId,
            stepId: document.stepId,
            bindingNumber: (previous?.number ?? 0) + 1,
            binding: document,
            bindingSha256: sha256Of(document),
            state: 'draft',
            capturedAgainstRevisionId: document.capturedAgainstRevisionId as never,
            parentBindingId: input.parentBindingId ?? null,
          })
          .returning();

        // Superseding the parent in the same transaction is what keeps "one live
        // binding per step" true rather than merely intended.
        if (input.parentBindingId !== undefined) {
          await tx
            .update(executionBindings)
            .set({
              state: 'superseded',
              supersededByBindingId: id,
              updatedAt: new Date(),
            })
            .where(eq(executionBindings.id, input.parentBindingId));
        }

        return toExecutionBindingRecord(row!);
      });
    },

    async findById(id) {
      const [row] = await executor
        .select()
        .from(executionBindings)
        .where(eq(executionBindings.id, id))
        .limit(1);

      return row === undefined ? null : toExecutionBindingRecord(row);
    },

    async listByDocument(documentId) {
      const rows = await executor
        .select()
        .from(executionBindings)
        .where(eq(executionBindings.documentId, documentId))
        .orderBy(asc(executionBindings.stepId), asc(executionBindings.bindingNumber));

      return rows.map(toExecutionBindingRecord);
    },

    async findCurrent(documentId, stepId) {
      const rows = await executor
        .select()
        .from(executionBindings)
        .where(
          and(eq(executionBindings.documentId, documentId), eq(executionBindings.stepId, stepId)),
        )
        .orderBy(desc(executionBindings.bindingNumber));

      const current = rows.find((row) => row.state !== 'superseded');
      return current === undefined ? null : toExecutionBindingRecord(current);
    },

    async listCurrent(documentId) {
      const rows = await executor
        .select()
        .from(executionBindings)
        .where(eq(executionBindings.documentId, documentId))
        .orderBy(desc(executionBindings.bindingNumber));

      // The newest non-superseded binding per step. Grouped here rather than in
      // SQL because the set is small and the rule is easier to read this way.
      const byStep = new Map<string, (typeof rows)[number]>();

      for (const row of rows) {
        if (row.state !== 'superseded' && !byStep.has(row.stepId)) {
          byStep.set(row.stepId, row);
        }
      }

      return [...byStep.values()].map(toExecutionBindingRecord);
    },

    async submitForReview(id) {
      return transition(id, 'needs_review', {});
    },

    async returnToDraft(id) {
      return transition(id, 'draft', {});
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
  };
}

/** Re-exported so callers need not reach past the repository for the table. */
export { BINDING_TRANSITIONS };
