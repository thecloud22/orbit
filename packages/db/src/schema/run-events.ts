import type { AgentVersionId, EventId, EventType, RunId, RunStepId } from '@orbit/contracts';
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, smallint, text, unique } from 'drizzle-orm/pg-core';

import { agentVersions } from './agent-versions';
import { createdAt, inValues, opaqueId, timestamptz } from './columns';
import { runSteps } from './run-steps';
import { runs } from './runs';

export const EVENT_TYPES = [
  'run.queued',
  'run.started',
  'run.completed',
  'run.failed',

  'step.started',
  'step.completed',
  'step.failed',

  'browser.navigation.completed',
  'browser.fill.completed',
  'browser.click.completed',
  'browser.extract.completed',

  'assertion.passed',
  'assertion.failed',

  'decision.requested',
  'decision.resolved',
  'decision.refused',

  'artifact.created',
] as const;

export const EVENT_SCHEMA_VERSION = '0.1';

/**
 * The append-only structured event log for a run.
 *
 * `sequence` is the ordering authority, not `occurredAt`: two events written in
 * the same millisecond must still have a defined order, and clocks must never
 * decide what happened first.
 *
 * `agentVersionId` is stored on every event rather than inferred through the
 * run, because the event envelope contract requires the exact version to travel
 * with the event wherever it is read.
 *
 * Artifact references are not a column here. They live in `artifact_links` rows
 * targeting the event, so a reference cannot point at an artifact that does not
 * exist; the repository composes them back into `artifactRefs` on read.
 *
 * Append-only is enforced by the repository API, which has no update or delete
 * path, and by tests. Database-level enforcement is deferred (see ADR-014).
 */
export const runEvents = pgTable(
  'run_events',
  {
    id: opaqueId<EventId>('id').primaryKey(),
    runId: opaqueId<RunId>('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    runStepId: opaqueId<RunStepId>('run_step_id').references(() => runSteps.id, {
      onDelete: 'cascade',
    }),
    agentVersionId: opaqueId<AgentVersionId>('agent_version_id')
      .notNull()
      .references(() => agentVersions.id, { onDelete: 'restrict' }),
    agentStepId: text('agent_step_id'),
    attempt: smallint('attempt'),
    schemaVersion: text('schema_version').notNull().default(EVENT_SCHEMA_VERSION),
    eventType: text('event_type').$type<EventType>().notNull(),
    sequence: integer('sequence').notNull(),
    occurredAt: timestamptz('occurred_at').notNull(),
    /** Safe structured detail. Never secrets, credentials, or raw page content. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [
    unique('run_events_run_id_sequence_unique').on(table.runId, table.sequence),
    index('run_events_run_id_event_type_idx').on(table.runId, table.eventType),
    index('run_events_run_step_id_idx').on(table.runStepId),
    check('run_events_event_type_check', inValues(table.eventType, EVENT_TYPES)),
    check('run_events_sequence_check', sql`${table.sequence} >= 1`),
    check('run_events_attempt_check', sql`${table.attempt} IS NULL OR ${table.attempt} >= 1`),
  ],
);

export type RunEventRow = typeof runEvents.$inferSelect;
export type NewRunEventRow = typeof runEvents.$inferInsert;
