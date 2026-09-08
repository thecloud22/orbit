import type {
  ArtifactId,
  ArtifactLinkId,
  ArtifactLinkRole,
  EventId,
  RunId,
  RunStepId,
} from '@orbit/contracts';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, unique } from 'drizzle-orm/pg-core';

import { artifacts } from './artifacts';
import { createdAt, inValues, opaqueId } from './columns';
import { runEvents } from './run-events';
import { runSteps } from './run-steps';
import { runs } from './runs';

export const ARTIFACT_LINK_ROLES = [
  'screenshot_after_action',
  'dom_snapshot',
  'browser_trace',
  'error_context',
  'extracted_json',
  'decision_input',
] as const;

/**
 * Why an artifact is attached to a run, a step, or an event.
 *
 * The target is three nullable foreign keys plus a check requiring exactly one,
 * rather than a polymorphic `(target_type, target_id)` pair. A polymorphic pair
 * cannot carry a foreign key, so links could quietly point at rows that no
 * longer exist — unacceptable when the link *is* the evidence trail. The
 * repository maps rows to and from the `ArtifactLink` discriminated union, so
 * callers still see `{ targetType, targetId, role }`.
 *
 * Adding future targets (step attempt, SOP Graph node, approval request) is one
 * nullable column and a widened check, which is why Phase 1 does not need them
 * modelled now.
 */
export const artifactLinks = pgTable(
  'artifact_links',
  {
    id: opaqueId<ArtifactLinkId>('id').primaryKey(),
    artifactId: opaqueId<ArtifactId>('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    role: text('role').$type<ArtifactLinkRole>().notNull(),
    runId: opaqueId<RunId>('run_id').references(() => runs.id, { onDelete: 'cascade' }),
    runStepId: opaqueId<RunStepId>('run_step_id').references(() => runSteps.id, {
      onDelete: 'cascade',
    }),
    runEventId: opaqueId<EventId>('run_event_id').references(() => runEvents.id, {
      onDelete: 'cascade',
    }),
    createdAt: createdAt(),
  },
  (table) => [
    unique('artifact_links_target_unique')
      .on(table.artifactId, table.role, table.runId, table.runStepId, table.runEventId)
      // Without this, two identical links differing only in NULL targets would
      // both be accepted, because NULLs are distinct by default.
      .nullsNotDistinct(),
    index('artifact_links_artifact_id_idx').on(table.artifactId),
    index('artifact_links_run_id_idx').on(table.runId),
    index('artifact_links_run_step_id_idx').on(table.runStepId),
    index('artifact_links_run_event_id_idx').on(table.runEventId),
    check('artifact_links_role_check', inValues(table.role, ARTIFACT_LINK_ROLES)),
    check(
      'artifact_links_exactly_one_target_check',
      sql`num_nonnulls(${table.runId}, ${table.runStepId}, ${table.runEventId}) = 1`,
    ),
  ],
);

export type ArtifactLinkRow = typeof artifactLinks.$inferSelect;
export type NewArtifactLinkRow = typeof artifactLinks.$inferInsert;
