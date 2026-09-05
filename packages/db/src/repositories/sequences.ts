import type { RunId } from '@orbit/contracts';
import { eq, sql } from 'drizzle-orm';

import type { Executor } from '../client';
import { RecordNotFoundError } from '../errors';
import { runs } from '../schema';

/**
 * Server-side sequence allocation.
 *
 * The counter lives on the run row, so incrementing it takes that row's lock
 * and serializes every writer for the run. Two workers appending events
 * concurrently cannot receive the same number, and no gap appears, because the
 * allocation and the insert happen in one transaction — unlike
 * `max(sequence) + 1`, which races between the read and the write.
 *
 * `RETURNING` yields the post-increment value, so the sequence the caller owns
 * is one less than what comes back.
 */
async function allocate(
  executor: Executor,
  runId: RunId,
  column: typeof runs.nextEventSequence | typeof runs.nextStepSequence,
  columnName: 'nextEventSequence' | 'nextStepSequence',
): Promise<number> {
  const rows = await executor
    .update(runs)
    .set({ [columnName]: sql`${column} + 1` })
    .where(eq(runs.id, runId))
    .returning({ next: column });

  const row = rows[0];

  if (row === undefined) {
    throw new RecordNotFoundError(`Run ${runId} does not exist, so no sequence can be allocated.`);
  }

  return row.next - 1;
}

export async function allocateEventSequence(executor: Executor, runId: RunId): Promise<number> {
  return allocate(executor, runId, runs.nextEventSequence, 'nextEventSequence');
}

export async function allocateStepSequence(executor: Executor, runId: RunId): Promise<number> {
  return allocate(executor, runId, runs.nextStepSequence, 'nextStepSequence');
}
