import type { ArtifactId, ArtifactKind, RunId, RunStepId } from '@orbit/contracts';
import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, unique } from 'drizzle-orm/pg-core';

import { createdAt, inValues, isSha256, opaqueId, timestamptz } from './columns';
import { runSteps } from './run-steps';
import { runs } from './runs';

export const ARTIFACT_KINDS = [
  'browser_screenshot',
  'dom_snapshot',
  'browser_trace',
  'extracted_json',
  'error_context',
  'decision_input',
] as const;

/** Extension point for artifact authorization; Phase 1 demo data is all `internal`. */
export const ARTIFACT_SENSITIVITIES = ['internal', 'sensitive', 'restricted'] as const;

/**
 * Artifact metadata. Bytes live in artifact storage, never in PostgreSQL
 * (ADR-004, ADR-010) — this table has no binary column of any kind.
 *
 * `storageKey` is NOT NULL on purpose. Task 5 derives the key, writes the bytes,
 * and only then inserts this row, so a metadata row always points at something
 * real. A nullable key would permit a phantom record that claims evidence
 * exists when it does not, which is exactly the silent failure the evidence
 * model must not allow.
 */
export const artifacts = pgTable(
  'artifacts',
  {
    id: opaqueId<ArtifactId>('id').primaryKey(),
    runId: opaqueId<RunId>('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    runStepId: opaqueId<RunStepId>('run_step_id').references(() => runSteps.id, {
      onDelete: 'cascade',
    }),
    kind: text('kind').$type<ArtifactKind>().notNull(),
    contentType: text('content_type').notNull(),
    storageKey: text('storage_key').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    sensitivity: text('sensitivity')
      .$type<(typeof ARTIFACT_SENSITIVITIES)[number]>()
      .notNull()
      .default('internal'),
    /** Extension point: which redaction pass produced these bytes. */
    redactionVersion: text('redaction_version'),
    /** Extension point: retention jobs are not implemented in Phase 1. */
    retentionExpiresAt: timestamptz('retention_expires_at'),
    createdAt: createdAt(),
  },
  (table) => [
    unique('artifacts_storage_key_unique').on(table.storageKey),
    index('artifacts_run_id_idx').on(table.runId),
    index('artifacts_run_id_kind_idx').on(table.runId, table.kind),
    index('artifacts_run_step_id_idx').on(table.runStepId),
    check('artifacts_kind_check', inValues(table.kind, ARTIFACT_KINDS)),
    check('artifacts_sensitivity_check', inValues(table.sensitivity, ARTIFACT_SENSITIVITIES)),
    check('artifacts_size_bytes_check', sql`${table.sizeBytes} >= 0`),
    check('artifacts_sha256_check', isSha256(table.sha256)),
    check('artifacts_storage_key_check', sql`length(${table.storageKey}) > 0`),
  ],
);

export type ArtifactRow = typeof artifacts.$inferSelect;
export type NewArtifactRow = typeof artifacts.$inferInsert;
