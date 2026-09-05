import {
  newRunId,
  type AgentVersionId,
  type BusinessOutcome,
  type OrbitError,
  type RunId,
  type RunInputs,
  type RunOutputs,
  type RunStatus,
  type RunTrigger,
} from '@orbit/contracts';
import { and, desc, eq, inArray } from 'drizzle-orm';

import type { Executor } from '../client';
import { InvalidRunTransitionError, RecordNotFoundError } from '../errors';
import { toRunRecord, type RunRecord } from '../mappers';
import { runs } from '../schema';

export interface CreateRunInput {
  readonly agentVersionId: AgentVersionId;
  readonly trigger: RunTrigger;
  /** Validated against the agent version's input declarations before this call. */
  readonly inputs: RunInputs;
  readonly id?: RunId;
  readonly queuedAt?: Date;
}

export interface CompleteRunInput {
  readonly businessOutcome: Exclude<BusinessOutcome, 'none'>;
  readonly outputs: RunOutputs;
  readonly finishedAt?: Date;
}

export interface FailRunInput {
  readonly error: OrbitError;
  readonly finishedAt?: Date;
  readonly businessOutcome?: BusinessOutcome;
}

export interface RunRepository {
  create(input: CreateRunInput): Promise<RunRecord>;
  findById(id: RunId): Promise<RunRecord | null>;
  listByAgentVersion(
    agentVersionId: AgentVersionId,
    options?: { readonly limit?: number },
  ): Promise<readonly RunRecord[]>;
  markRunning(id: RunId, startedAt?: Date): Promise<RunRecord>;
  complete(id: RunId, input: CompleteRunInput): Promise<RunRecord>;
  fail(id: RunId, input: FailRunInput): Promise<RunRecord>;
  cancel(id: RunId, finishedAt?: Date): Promise<RunRecord>;
}

const ACTIVE_STATUSES: readonly RunStatus[] = ['queued', 'running'];

export function createRunRepository(executor: Executor): RunRepository {
  /**
   * Applies a status transition only from the statuses that permit it.
   *
   * The expected status is part of the WHERE clause rather than a prior read,
   * so a concurrent writer cannot slip between the check and the write. Zero
   * rows updated means the transition was illegal, which raises — a run must
   * never be quietly moved from `succeeded` to `failed`.
   */
  async function transition(
    id: RunId,
    from: readonly RunStatus[],
    set: Partial<typeof runs.$inferInsert>,
    intent: string,
  ): Promise<RunRecord> {
    const rows = await executor
      .update(runs)
      .set({ ...set, updatedAt: new Date() })
      .where(and(eq(runs.id, id), inArray(runs.status, from)))
      .returning();

    const row = rows[0];

    if (row !== undefined) {
      return toRunRecord(row);
    }

    const [existing] = await executor.select().from(runs).where(eq(runs.id, id)).limit(1);

    if (existing === undefined) {
      throw new RecordNotFoundError(`Run ${id} does not exist.`);
    }

    throw new InvalidRunTransitionError(
      `Cannot ${intent} run ${id}: it is "${existing.status}", and this transition requires one of ${from.join(', ')}.`,
    );
  }

  return {
    async create(input) {
      const queuedAt = input.queuedAt ?? new Date();

      const [row] = await executor
        .insert(runs)
        .values({
          id: input.id ?? newRunId(),
          agentVersionId: input.agentVersionId,
          status: 'queued',
          businessOutcome: 'none',
          trigger: input.trigger,
          inputs: input.inputs,
          queuedAt,
        })
        .returning();

      return toRunRecord(row!);
    },

    async findById(id) {
      const [row] = await executor.select().from(runs).where(eq(runs.id, id)).limit(1);
      return row === undefined ? null : toRunRecord(row);
    },

    async listByAgentVersion(agentVersionId, options) {
      const query = executor
        .select()
        .from(runs)
        .where(eq(runs.agentVersionId, agentVersionId))
        .orderBy(desc(runs.queuedAt));

      const rows = await (options?.limit === undefined ? query : query.limit(options.limit));
      return rows.map(toRunRecord);
    },

    async markRunning(id, startedAt) {
      return transition(
        id,
        ['queued'],
        { status: 'running', startedAt: startedAt ?? new Date() },
        'start',
      );
    },

    async complete(id, input) {
      return transition(
        id,
        ['running'],
        {
          status: 'succeeded',
          businessOutcome: input.businessOutcome,
          outputs: input.outputs,
          finishedAt: input.finishedAt ?? new Date(),
        },
        'complete',
      );
    },

    async fail(id, input) {
      return transition(
        id,
        ACTIVE_STATUSES,
        {
          status: 'failed',
          error: input.error,
          ...(input.businessOutcome === undefined
            ? {}
            : { businessOutcome: input.businessOutcome }),
          finishedAt: input.finishedAt ?? new Date(),
        },
        'fail',
      );
    },

    async cancel(id, finishedAt) {
      return transition(
        id,
        ACTIVE_STATUSES,
        { status: 'cancelled', finishedAt: finishedAt ?? new Date() },
        'cancel',
      );
    },
  };
}
