import {
  newRunStepId,
  type OrbitError,
  type RunId,
  type RunStepId,
  type RunStepStatus,
} from '@orbit/contracts';
import { and, asc, eq, inArray } from 'drizzle-orm';

import type { Executor } from '../client';
import { InvalidRunTransitionError, RecordNotFoundError } from '../errors';
import { toRunStepRecord, type RunStepRecord } from '../mappers';
import { runSteps } from '../schema';
import { allocateStepSequence } from './sequences';

export interface StartRunStepInput {
  readonly runId: RunId;
  readonly agentStepId: string;
  readonly stepType: string;
  /** Always 1 in Phase 1; the retry engine that increments it does not exist yet. */
  readonly attempt?: number;
  readonly startedAt?: Date;
  readonly id?: RunStepId;
}

export interface CompleteRunStepInput {
  /** Safe output only: extracted values, selected alternative, assertion result. */
  readonly output?: Record<string, unknown>;
  readonly finishedAt?: Date;
}

export interface FailRunStepInput {
  readonly error: OrbitError;
  readonly finishedAt?: Date;
}

export interface RunStepRepository {
  /** Allocates the run-scoped execution sequence and records the step as running. */
  start(input: StartRunStepInput): Promise<RunStepRecord>;
  complete(id: RunStepId, input?: CompleteRunStepInput): Promise<RunStepRecord>;
  fail(id: RunStepId, input: FailRunStepInput): Promise<RunStepRecord>;
  findById(id: RunStepId): Promise<RunStepRecord | null>;
  /** Ordered by execution sequence, which is the authority — not insertion or timestamps. */
  listByRun(runId: RunId): Promise<readonly RunStepRecord[]>;
}

export function createRunStepRepository(executor: Executor): RunStepRepository {
  async function transition(
    id: RunStepId,
    from: readonly RunStepStatus[],
    set: Partial<typeof runSteps.$inferInsert>,
    intent: string,
  ): Promise<RunStepRecord> {
    const rows = await executor
      .update(runSteps)
      .set({ ...set, updatedAt: new Date() })
      .where(and(eq(runSteps.id, id), inArray(runSteps.status, from)))
      .returning();

    const row = rows[0];

    if (row !== undefined) {
      return toRunStepRecord(row);
    }

    const [existing] = await executor.select().from(runSteps).where(eq(runSteps.id, id)).limit(1);

    if (existing === undefined) {
      throw new RecordNotFoundError(`Run step ${id} does not exist.`);
    }

    throw new InvalidRunTransitionError(
      `Cannot ${intent} run step ${id}: it is "${existing.status}", and this transition requires one of ${from.join(', ')}.`,
    );
  }

  return {
    async start(input) {
      // Allocation and insert share one transaction, so a rejected step insert
      // cannot consume a sequence number and leave a gap in the execution order.
      return executor.transaction(async (tx) => {
        const sequence = await allocateStepSequence(tx, input.runId);

        const [row] = await tx
          .insert(runSteps)
          .values({
            id: input.id ?? newRunStepId(),
            runId: input.runId,
            agentStepId: input.agentStepId,
            stepType: input.stepType,
            sequence,
            attempt: input.attempt ?? 1,
            status: 'running',
            startedAt: input.startedAt ?? new Date(),
          })
          .returning();

        return toRunStepRecord(row!);
      });
    },

    async complete(id, input) {
      return transition(
        id,
        ['pending', 'running'],
        {
          status: 'succeeded',
          ...(input?.output === undefined ? {} : { output: input.output }),
          finishedAt: input?.finishedAt ?? new Date(),
        },
        'complete',
      );
    },

    async fail(id, input) {
      return transition(
        id,
        ['pending', 'running'],
        { status: 'failed', error: input.error, finishedAt: input.finishedAt ?? new Date() },
        'fail',
      );
    },

    async findById(id) {
      const [row] = await executor.select().from(runSteps).where(eq(runSteps.id, id)).limit(1);
      return row === undefined ? null : toRunStepRecord(row);
    },

    async listByRun(runId) {
      const rows = await executor
        .select()
        .from(runSteps)
        .where(eq(runSteps.runId, runId))
        .orderBy(asc(runSteps.sequence));

      return rows.map(toRunStepRecord);
    },
  };
}
