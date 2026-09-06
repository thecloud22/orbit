import type { SopDocumentId, SopRevisionId } from '@orbit/contracts';
import type { SopGraph } from '@orbit/sop-graph';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { createdAt, inValues, isSha256, opaqueId, timestamptz, updatedAt } from './columns';
import { sopDocuments } from './sop-documents';

/**
 * The lifecycle of one graph revision.
 *
 * `approved`, `rejected` and `superseded` are statements about a specific
 * revision rather than about the document, which is why the column lives here.
 */
export const SOP_REVISION_STATES = [
  'draft',
  'needs_clarification',
  'in_review',
  'approved',
  'rejected',
  'superseded',
] as const;

export type SopRevisionState = (typeof SOP_REVISION_STATES)[number];

/**
 * Where a revision came from.
 *
 * `recorded` is its own kind rather than being folded into `authored`: a
 * workflow someone demonstrated in a browser and one someone typed out are
 * different artifacts with different trust, and provenance exists precisely to
 * keep that answerable. It is a union on a JSONB column, so no migration.
 */
export const SOP_PROVENANCE_KINDS = ['authored', 'generated', 'edited', 'recorded'] as const;

export interface SopRevisionProvenance {
  readonly kind: (typeof SOP_PROVENANCE_KINDS)[number];
  /** Populated only for `generated`; the plumbing arrives in Phase 2.2. */
  readonly model?: string;
  readonly provider?: string;
  readonly promptVersion?: string;
  readonly generatedAt?: string;
  /** For `edited`: a short note about what the human changed and why. */
  readonly note?: string;
  /** For `recorded`: where the recording started. Never fetched. */
  readonly recordedFromUrl?: string;
  /** For `recorded`: how many interactions the person performed. */
  readonly recordedActionCount?: number;
}

/**
 * One immutable version of a document's SOP Graph.
 *
 * The whole validated graph is stored as JSONB beside a checksum, the same shape
 * `agent_versions` already uses: the graph is a versioned contract owned by
 * @orbit/sop-graph and always read back as one unit, and shredding it into step
 * and branch tables would fork the contract and turn every schema change into a
 * migration.
 *
 * Revisions are immutable apart from their state and their supersession
 * pointer. There is no update path for `graph`, so an edit is a new revision and
 * the revision chain *is* the edit history — which is also what makes "which
 * revision was approved?" answerable long after the fact.
 *
 * `graphSha256` is recomputed on read, so a revision altered out of band is
 * detected rather than served as if it were the reviewed one.
 */
export const sopGraphRevisions = pgTable(
  'sop_graph_revisions',
  {
    id: opaqueId<SopRevisionId>('id').primaryKey(),
    documentId: opaqueId<SopDocumentId>('document_id')
      .notNull()
      // Cascade: a document's revisions are part of it, not independent records.
      .references(() => sopDocuments.id, { onDelete: 'cascade' }),
    revisionNumber: integer('revision_number').notNull(),
    graph: jsonb('graph').$type<SopGraph>().notNull(),
    graphSha256: text('graph_sha256').notNull(),
    state: text('state').$type<SopRevisionState>().notNull().default('draft'),
    provenance: jsonb('provenance').$type<SopRevisionProvenance>().notNull(),
    /**
     * The revision this one was derived from, and the one that replaced it.
     * Together they form the edit history.
     *
     * Both are real foreign keys rather than loose id columns: this chain *is*
     * the record of what was reviewed and what replaced it, and a pointer that
     * can quietly reference a row that no longer exists is not a record. They
     * are `set null` rather than `cascade` so removing one revision can never
     * silently take a neighbouring one with it.
     */
    parentRevisionId: opaqueId<SopRevisionId>('parent_revision_id').references(
      (): AnyPgColumn => sopGraphRevisions.id,
      { onDelete: 'set null' },
    ),
    supersededByRevisionId: opaqueId<SopRevisionId>('superseded_by_revision_id').references(
      (): AnyPgColumn => sopGraphRevisions.id,
      { onDelete: 'set null' },
    ),
    reviewedAt: timestamptz('reviewed_at'),
    /** Why a reviewer approved or rejected. Never a secret or page content. */
    reviewNote: text('review_note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('sop_graph_revisions_document_id_revision_number_unique').on(
      table.documentId,
      table.revisionNumber,
    ),
    index('sop_graph_revisions_document_id_idx').on(table.documentId),
    index('sop_graph_revisions_state_idx').on(table.state),
    check('sop_graph_revisions_state_check', inValues(table.state, SOP_REVISION_STATES)),
    check('sop_graph_revisions_graph_sha256_check', isSha256(table.graphSha256)),
    check('sop_graph_revisions_revision_number_check', sql`${table.revisionNumber} >= 1`),
    // A reviewed revision always records when it was reviewed.
    check(
      'sop_graph_revisions_reviewed_at_check',
      sql`${table.state} NOT IN ('approved', 'rejected') OR ${table.reviewedAt} IS NOT NULL`,
    ),
  ],
);

export type SopGraphRevisionRow = typeof sopGraphRevisions.$inferSelect;
export type NewSopGraphRevisionRow = typeof sopGraphRevisions.$inferInsert;
