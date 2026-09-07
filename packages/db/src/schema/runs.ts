import {
  BUSINESS_OUTCOME_PATTERN,
  type AgentVersionId,
  type OrbitError,
  type RunId,
  type RunInputs,
  type RunOutputs,
  type RunTrigger,
} from '@orbit/contracts';
import { check, index, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { agentVersions } from './agent-versions';
import { createdAt, inValues, opaqueId, timestamptz, updatedAt } from './columns';

export const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;

/**
 * A business outcome is a declared identifier, so the column is checked for
 * *format* rather than against a list of names (ADR-030). The pattern is the
 * contract's own, so the database and `businessOutcomeSchema` cannot disagree
 * about what the column may hold.
 */
function isBusinessOutcome(column: unknown) {
  return sql`${column} ~ ${sql.raw(`'${BUSINESS_OUTCOME_PATTERN.source}'`)}`;
}

/**
 * One execution of one exact Agent Version.
 *
 * `status` and `businessOutcome` are deliberately separate columns (ADR-006):
 * a run that correctly establishes a request does not exist is
 * `succeeded` / `request_not_found`, not a failure.
 *
 * `nextStepSequence` and `nextEventSequence` are server-side allocators. A
 * writer increments the counter and inserts its row in the same transaction, so
 * the row lock on this run serializes sequence assignment without a
 * read-modify-write race; the unique constraints on the child tables are the
 * backstop if that ever fails.
 */
export const runs = pgTable(
  'runs',
  {
    id: opaqueId<RunId>('id').primaryKey(),
    agentVersionId: opaqueId<AgentVersionId>('agent_version_id')
      .notNull()
      // Restrict: evidence must not be deletable by removing the definition
      // that produced it.
      .references(() => agentVersions.id, { onDelete: 'restrict' }),
    status: text('status').$type<(typeof RUN_STATUSES)[number]>().notNull().default('queued'),
    businessOutcome: text('business_outcome').notNull().default('none'),
    trigger: jsonb('trigger').$type<RunTrigger>().notNull(),
    inputs: jsonb('inputs').$type<RunInputs>().notNull(),
    outputs: jsonb('outputs').$type<RunOutputs>(),
    error: jsonb('error').$type<OrbitError>(),
    nextStepSequence: integer('next_step_sequence').notNull().default(1),
    nextEventSequence: integer('next_event_sequence').notNull().default(1),
    queuedAt: timestamptz('queued_at').notNull().defaultNow(),
    startedAt: timestamptz('started_at'),
    finishedAt: timestamptz('finished_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('runs_agent_version_id_idx').on(table.agentVersionId),
    index('runs_status_idx').on(table.status),
    index('runs_queued_at_idx').on(table.queuedAt),
    check('runs_status_check', inValues(table.status, RUN_STATUSES)),
    check('runs_business_outcome_check', isBusinessOutcome(table.businessOutcome)),
    // A terminal run always records when it finished.
    check(
      'runs_terminal_finished_at_check',
      sql`${table.status} IN ('queued', 'running') OR ${table.finishedAt} IS NOT NULL`,
    ),
    check('runs_next_step_sequence_check', sql`${table.nextStepSequence} >= 1`),
    check('runs_next_event_sequence_check', sql`${table.nextEventSequence} >= 1`),
  ],
);

export type RunRow = typeof runs.$inferSelect;
export type NewRunRow = typeof runs.$inferInsert;
