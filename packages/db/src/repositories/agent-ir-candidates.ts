import type { AgentIr } from '@orbit/agent-ir';
import {
  newAgentIrCandidateId,
  type AgentIrCandidateId,
  type SopDocumentId,
  type SopRevisionId,
} from '@orbit/contracts';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import { sha256Of } from '../checksum';
import type { Executor } from '../client';
import { InvalidRunTransitionError, OrbitDatabaseError, RecordNotFoundError } from '../errors';
import { toAgentIrCandidateRecord, type AgentIrCandidateRecord } from '../mappers';
import {
  agentIrCandidates,
  candidateStatesAllowedToReach,
  type CandidateSandboxState,
  type CandidateState,
} from '../schema';

/** A candidate that is not valid Agent IR never becomes a stored one. */
export class AgentIrCandidateValidationError extends OrbitDatabaseError {}

/** Approving a candidate that was never checked is refused here, not in the UI. */
export class CandidateNotValidatedError extends OrbitDatabaseError {}

export interface CreateAgentIrCandidateInput {
  readonly documentId: SopDocumentId;
  readonly revisionId: SopRevisionId;
  readonly agentIr: AgentIr;
  readonly compiledFromBindingIds: readonly string[];
  readonly secretInputIds: readonly string[];
  readonly sandboxState: CandidateSandboxState;
  readonly sandboxNote?: string;
  readonly id?: AgentIrCandidateId;
}

export interface ReviewCandidateInput {
  readonly reviewNote?: string;
  readonly reviewedAt?: Date;
}

/**
 * Candidate Agent IR.
 *
 * There is no method that rewrites a stored candidate. Recompiling creates the
 * next one and supersedes its parent in the same transaction, so the chain is
 * the compilation history and an approved candidate stays exactly as approved —
 * the same posture bindings and revisions already take.
 */
export interface AgentIrCandidateRepository {
  create(input: CreateAgentIrCandidateInput): Promise<AgentIrCandidateRecord>;
  findById(id: AgentIrCandidateId): Promise<AgentIrCandidateRecord | null>;
  listByDocument(documentId: SopDocumentId): Promise<readonly AgentIrCandidateRecord[]>;
  /** The newest candidate that has not been superseded. */
  findCurrent(documentId: SopDocumentId): Promise<AgentIrCandidateRecord | null>;

  /**
   * The separate technical approval the requirements call for.
   *
   * Refuses a candidate that was never checked. That rule lives here rather
   * than in a service because it is the one thing standing between a compiled
   * proposal and something 2.6 will publish, and a guard that can be bypassed
   * by calling a different function is not a guard.
   */
  approve(id: AgentIrCandidateId, input?: ReviewCandidateInput): Promise<AgentIrCandidateRecord>;
  reject(id: AgentIrCandidateId, input?: ReviewCandidateInput): Promise<AgentIrCandidateRecord>;
}

export function createAgentIrCandidateRepository(executor: Executor): AgentIrCandidateRepository {
  /**
   * Applies a transition only from the states that permit it.
   *
   * Permitted states go in the `WHERE` clause rather than a prior read, so a
   * concurrent writer cannot slip between the check and the write.
   */
  async function transition(
    id: AgentIrCandidateId,
    target: CandidateState,
    set: Partial<typeof agentIrCandidates.$inferInsert>,
  ): Promise<AgentIrCandidateRecord> {
    const from = candidateStatesAllowedToReach(target);

    const rows = await executor
      .update(agentIrCandidates)
      .set({ ...set, state: target, updatedAt: new Date() })
      .where(and(eq(agentIrCandidates.id, id), inArray(agentIrCandidates.state, from)))
      .returning();

    const row = rows[0];

    if (row !== undefined) {
      return toAgentIrCandidateRecord(row);
    }

    const [existing] = await executor
      .select()
      .from(agentIrCandidates)
      .where(eq(agentIrCandidates.id, id))
      .limit(1);

    if (existing === undefined) {
      throw new RecordNotFoundError(`Agent IR candidate ${id} does not exist.`);
    }

    throw new InvalidRunTransitionError(
      `Cannot move Agent IR candidate ${id} to "${target}": it is "${existing.state}", and that transition is only allowed from ${from.join(', ')}.`,
    );
  }

  return {
    async create(input) {
      const document = { ...input.agentIr };

      return executor.transaction(async (tx) => {
        const [previous] = await tx
          .select({
            id: agentIrCandidates.id,
            number: agentIrCandidates.candidateNumber,
          })
          .from(agentIrCandidates)
          .where(
            and(
              eq(agentIrCandidates.documentId, input.documentId),
              isNull(agentIrCandidates.supersededByCandidateId),
            ),
          )
          .orderBy(desc(agentIrCandidates.candidateNumber))
          .limit(1);

        const id = input.id ?? newAgentIrCandidateId();

        const [row] = await tx
          .insert(agentIrCandidates)
          .values({
            id,
            documentId: input.documentId,
            revisionId: input.revisionId,
            candidateNumber: (previous?.number ?? 0) + 1,
            agentIr: document,
            agentIrSha256: sha256Of(document),
            // Always empty now: an outcome is the workflow's own name (ADR-030).
            outcomeMapping: {},
            compiledFromBindingIds: input.compiledFromBindingIds,
            secretInputIds: input.secretInputIds,
            sandboxState: input.sandboxState,
            ...(input.sandboxNote === undefined ? {} : { sandboxNote: input.sandboxNote }),
          })
          .returning();

        if (row === undefined) {
          throw new AgentIrCandidateValidationError('Inserting the candidate returned no row.');
        }

        // Superseded in the same transaction as its replacement is written, so
        // there is never a moment with two current candidates or with none.
        if (previous !== undefined) {
          await tx
            .update(agentIrCandidates)
            .set({ supersededByCandidateId: id, state: 'superseded', updatedAt: new Date() })
            .where(eq(agentIrCandidates.id, previous.id));
        }

        return toAgentIrCandidateRecord(row);
      });
    },

    async findById(id) {
      const [row] = await executor
        .select()
        .from(agentIrCandidates)
        .where(eq(agentIrCandidates.id, id))
        .limit(1);

      return row === undefined ? null : toAgentIrCandidateRecord(row);
    },

    async listByDocument(documentId) {
      const rows = await executor
        .select()
        .from(agentIrCandidates)
        .where(eq(agentIrCandidates.documentId, documentId))
        .orderBy(desc(agentIrCandidates.candidateNumber));

      return rows.map(toAgentIrCandidateRecord);
    },

    async findCurrent(documentId) {
      const [row] = await executor
        .select()
        .from(agentIrCandidates)
        .where(
          and(
            eq(agentIrCandidates.documentId, documentId),
            isNull(agentIrCandidates.supersededByCandidateId),
          ),
        )
        .orderBy(desc(agentIrCandidates.candidateNumber))
        .limit(1);

      return row === undefined ? null : toAgentIrCandidateRecord(row);
    },

    async approve(id, input) {
      const [existing] = await executor
        .select({ sandboxState: agentIrCandidates.sandboxState })
        .from(agentIrCandidates)
        .where(eq(agentIrCandidates.id, id))
        .limit(1);

      if (existing === undefined) {
        throw new RecordNotFoundError(`Agent IR candidate ${id} does not exist.`);
      }

      if (existing.sandboxState !== 'ready') {
        throw new CandidateNotValidatedError(
          `Agent IR candidate ${id} cannot be approved: it is "${existing.sandboxState}". ` +
            'A candidate nobody could check is not a candidate anybody can approve.',
        );
      }

      return transition(id, 'approved', {
        reviewedAt: input?.reviewedAt ?? new Date(),
        ...(input?.reviewNote === undefined ? {} : { reviewNote: input.reviewNote }),
      });
    },

    async reject(id, input) {
      // Rejection has no readiness precondition: refusing something nobody
      // could check is exactly what a reviewer should be able to do.
      return transition(id, 'rejected', {
        reviewedAt: input?.reviewedAt ?? new Date(),
        ...(input?.reviewNote === undefined ? {} : { reviewNote: input.reviewNote }),
      });
    },
  };
}
