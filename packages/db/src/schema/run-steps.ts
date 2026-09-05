import type { OrbitError, RunId, RunStepId, RunStepStatus } from '@orbit/contracts';
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, smallint, text, unique } from 'drizzle-orm/pg-core';

import { createdAt, inValues, opaqueId, timestamptz, updatedAt } from './columns';
import { runs } from './runs';

export const RUN_STEP_STATUSES = ['pending', 'running', 'succeeded', 'failed'] as const;

/**
 * One execution of one Agent IR step within a run.
 *
 * `attempt` is always 1 in Phase 1, which has no retry engine. It exists now
 * because the uniqueness rule depends on it: `(run_id, agent_step_id)` alone is
 * correct only while the step graph is acyclic and nothing re-executes, and
 * would have to be dropped the moment retries land. Including `attempt` gives
 * identical enforcement today and survives that design.
 *
 * `sourceSopStepIds` is deliberately absent: it is derivable from the immutable
 * pinned Agent IR, and a second copy would be a second source of traceability
 * truth that could disagree with the version actually executed.
 */
export const runSteps = pgTable(
  'run_steps',
  {
    id: opaqueId<RunStepId>('id').primaryKey(),
    runId: opaqueId<RunId>('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    agentStepId: text('agent_step_id').notNull(),
    stepType: text('step_type').notNull(),
    sequence: integer('sequence').notNull(),
    attempt: smallint('attempt').notNull().default(1),
    status: text('status').$type<RunStepStatus>().notNull(),
    startedAt: timestamptz('started_at'),
    finishedAt: timestamptz('finished_at'),
    /** Safe step output: extracted values, selected alternative, assertion result. Never secrets. */
    output: jsonb('output').$type<Record<string, unknown>>(),
    error: jsonb('error').$type<OrbitError>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('run_steps_run_id_sequence_unique').on(table.runId, table.sequence),
    unique('run_steps_run_id_agent_step_id_attempt_unique').on(
      table.runId,
      table.agentStepId,
      table.attempt,
    ),
    index('run_steps_run_id_sequence_idx').on(table.runId, table.sequence),
    check('run_steps_status_check', inValues(table.status, RUN_STEP_STATUSES)),
    check('run_steps_sequence_check', sql`${table.sequence} >= 1`),
    check('run_steps_attempt_check', sql`${table.attempt} >= 1`),
  ],
);

export type RunStepRow = typeof runSteps.$inferSelect;
export type NewRunStepRow = typeof runSteps.$inferInsert;
