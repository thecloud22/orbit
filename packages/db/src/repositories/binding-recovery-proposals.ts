import {
  newBindingRecoveryProposalId,
  type AgentVersionId,
  type BindingRecoveryProposalId,
  type ExecutionBindingId,
  type RunId,
  type SopDocumentId,
} from '@orbit/contracts';
import { parseExecutionBinding, type ExecutionBinding } from '@orbit/execution-mapping';
import { and, desc, eq, inArray } from 'drizzle-orm';

import { sha256Of } from '../checksum';
import type { Executor } from '../client';
import { InvalidRunTransitionError, OrbitDatabaseError, RecordNotFoundError } from '../errors';
import { toBindingRecoveryProposalRecord, type BindingRecoveryProposalRecord } from '../mappers';
import { bindingRecoveryProposals, type RecoveryProposalState } from '../schema';

/** An invalid proposed binding never becomes a stored proposal. */
export class RecoveryProposalValidationError extends OrbitDatabaseError {}

/** The open proposal for this step already exists; the caller gets it back. */
export class RecoveryProposalAlreadyOpenError extends OrbitDatabaseError {}

export interface CreateRecoveryProposalInput {
  readonly documentId: SopDocumentId;
  readonly stepId: string;
  readonly proposedForBindingId: ExecutionBindingId;
  readonly observedInRunId?: RunId;
  readonly observedInAgentVersionId?: AgentVersionId;
  readonly proposedBinding: ExecutionBinding;
  readonly diagnosis: Record<string, unknown>;
  /** False only if a model ever ranks candidates. Nothing sets that today. */
  readonly deterministic?: boolean;
  readonly id?: BindingRecoveryProposalId;
}

export interface ResolveRecoveryProposalInput {
  readonly resolutionNote?: string;
  readonly resolvedAt?: Date;
}

/**
 * Recovery proposals.
 *
 * There is no `apply`, and there never will be one here. A proposal is
 * accepted by creating a binding through the ordinary binding path and then
 * marking the proposal accepted — two writes the service performs in one
 * transaction — so this repository can move a proposal's state and record what
 * it produced, and cannot itself put anything in front of a browser (ADR-033).
 */
export interface BindingRecoveryProposalRepository {
  create(input: CreateRecoveryProposalInput): Promise<BindingRecoveryProposalRecord>;
  findById(id: BindingRecoveryProposalId): Promise<BindingRecoveryProposalRecord | null>;
  listByDocument(documentId: SopDocumentId): Promise<readonly BindingRecoveryProposalRecord[]>;
  /** Every proposal still waiting for a person, newest first. */
  listOpen(documentId: SopDocumentId): Promise<readonly BindingRecoveryProposalRecord[]>;
  findOpenForStep(
    documentId: SopDocumentId,
    stepId: string,
  ): Promise<BindingRecoveryProposalRecord | null>;

  /** Records that this proposal produced that binding. */
  accept(
    id: BindingRecoveryProposalId,
    resultingBindingId: ExecutionBindingId,
    input?: ResolveRecoveryProposalInput,
  ): Promise<BindingRecoveryProposalRecord>;
  dismiss(
    id: BindingRecoveryProposalId,
    input?: ResolveRecoveryProposalInput,
  ): Promise<BindingRecoveryProposalRecord>;
}

export function createBindingRecoveryProposalRepository(
  executor: Executor,
): BindingRecoveryProposalRepository {
  /**
   * Resolves a proposal only from `proposed`.
   *
   * The permitted state is in the `WHERE` clause rather than a prior read, the
   * way every other transition in this package works, so two reviewers clicking
   * accept at the same moment cannot both create a binding.
   */
  async function resolve(
    id: BindingRecoveryProposalId,
    target: Exclude<RecoveryProposalState, 'proposed'>,
    set: Partial<typeof bindingRecoveryProposals.$inferInsert>,
  ): Promise<BindingRecoveryProposalRecord> {
    const rows = await executor
      .update(bindingRecoveryProposals)
      .set({ ...set, state: target, updatedAt: new Date() })
      .where(
        and(
          eq(bindingRecoveryProposals.id, id),
          inArray(bindingRecoveryProposals.state, ['proposed']),
        ),
      )
      .returning();

    const row = rows[0];

    if (row !== undefined) {
      return toBindingRecoveryProposalRecord(row);
    }

    const [existing] = await executor
      .select()
      .from(bindingRecoveryProposals)
      .where(eq(bindingRecoveryProposals.id, id))
      .limit(1);

    if (existing === undefined) {
      throw new RecordNotFoundError(`Recovery proposal ${id} does not exist.`);
    }

    throw new InvalidRunTransitionError(
      `Cannot ${target === 'accepted' ? 'accept' : 'dismiss'} recovery proposal ${id}: it is already "${existing.state}".`,
    );
  }

  return {
    async create(input) {
      // Validated before anything is written, for the same reason a binding is:
      // a reviewer may accept this, and what they accept becomes what a browser
      // acts through.
      const parsed = parseExecutionBinding(input.proposedBinding);

      if (!parsed.ok) {
        throw new RecoveryProposalValidationError(
          `Refusing to store an invalid recovery proposal: ${JSON.stringify(parsed.issues, null, 2)}`,
        );
      }

      const document = { ...parsed.binding };

      // Checked before the insert as well as constrained in the index, because
      // "there is already an open proposal for this step" is an ordinary,
      // expected outcome that the caller reports as `already_proposed` — not a
      // database error to surface to a run.
      const open = await this.findOpenForStep(input.documentId, input.stepId);

      if (open !== null) {
        throw new RecoveryProposalAlreadyOpenError(
          `Step "${input.stepId}" already has an open recovery proposal (${open.id}).`,
        );
      }

      const [row] = await executor
        .insert(bindingRecoveryProposals)
        .values({
          id: input.id ?? newBindingRecoveryProposalId(),
          documentId: input.documentId,
          stepId: input.stepId,
          proposedForBindingId: input.proposedForBindingId,
          observedInRunId: input.observedInRunId ?? null,
          observedInAgentVersionId: input.observedInAgentVersionId ?? null,
          state: 'proposed',
          proposedBinding: document,
          proposedBindingSha256: sha256Of(document),
          diagnosis: input.diagnosis,
          deterministic: input.deterministic ?? true,
        })
        .returning();

      return toBindingRecoveryProposalRecord(row!);
    },

    async findById(id) {
      const [row] = await executor
        .select()
        .from(bindingRecoveryProposals)
        .where(eq(bindingRecoveryProposals.id, id))
        .limit(1);

      return row === undefined ? null : toBindingRecoveryProposalRecord(row);
    },

    async listByDocument(documentId) {
      const rows = await executor
        .select()
        .from(bindingRecoveryProposals)
        .where(eq(bindingRecoveryProposals.documentId, documentId))
        .orderBy(desc(bindingRecoveryProposals.createdAt));

      return rows.map(toBindingRecoveryProposalRecord);
    },

    async listOpen(documentId) {
      const rows = await executor
        .select()
        .from(bindingRecoveryProposals)
        .where(
          and(
            eq(bindingRecoveryProposals.documentId, documentId),
            eq(bindingRecoveryProposals.state, 'proposed'),
          ),
        )
        .orderBy(desc(bindingRecoveryProposals.createdAt));

      return rows.map(toBindingRecoveryProposalRecord);
    },

    async findOpenForStep(documentId, stepId) {
      const [row] = await executor
        .select()
        .from(bindingRecoveryProposals)
        .where(
          and(
            eq(bindingRecoveryProposals.documentId, documentId),
            eq(bindingRecoveryProposals.stepId, stepId),
            eq(bindingRecoveryProposals.state, 'proposed'),
          ),
        )
        .limit(1);

      return row === undefined ? null : toBindingRecoveryProposalRecord(row);
    },

    async accept(id, resultingBindingId, input) {
      return resolve(id, 'accepted', {
        resultingBindingId,
        resolvedAt: input?.resolvedAt ?? new Date(),
        resolutionNote: input?.resolutionNote ?? null,
      });
    },

    async dismiss(id, input) {
      return resolve(id, 'dismissed', {
        resolvedAt: input?.resolvedAt ?? new Date(),
        resolutionNote: input?.resolutionNote ?? null,
      });
    },
  };
}
