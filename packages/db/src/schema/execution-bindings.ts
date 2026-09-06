import type { ExecutionBindingId, SopDocumentId, SopRevisionId } from '@orbit/contracts';
import type { ExecutionBinding } from '@orbit/execution-mapping';
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
import { sopGraphRevisions } from './sop-graph-revisions';

/**
 * The lifecycle of one Execution Binding.
 *
 * Deliberately not `SOP_REVISION_STATES`. The shape is the same and the
 * enforcement mechanism is the same, but a binding is never asked a
 * clarification question, so `needs_clarification` has no meaning here — and
 * sharing the type would make a binding's state literally be a SOP revision's
 * state, coupling two entities that have nothing to do with each other.
 * See ADR-018.
 */
export const BINDING_STATES = [
  'draft',
  'needs_review',
  'approved',
  'rejected',
  'superseded',
] as const;

export type BindingState = (typeof BINDING_STATES)[number];

/**
 * What one SOP step does on a real page.
 *
 * Keyed by `(document_id, step_id)` rather than by revision. A binding records
 * how a step reaches a browser, and Task 3 made editing a graph routine — so
 * keying by revision would orphan every binding whenever any unrelated step
 * changed. `capturedAgainstRevisionId` inside the document records which
 * revision was on screen when the human demonstrated it, and the binding's own
 * `stepSha256` is what detects deterministically that *this* step has since
 * changed and the binding is stale.
 *
 * A re-recording supersedes its predecessor rather than replacing it, so the
 * chain is the mapping history, exactly as the revision chain is the edit
 * history (ADR-016).
 */
export const executionBindings = pgTable(
  'execution_bindings',
  {
    id: opaqueId<ExecutionBindingId>('id').primaryKey(),
    documentId: opaqueId<SopDocumentId>('document_id')
      .notNull()
      // Cascade: a document's bindings are part of it, not independent records.
      .references(() => sopDocuments.id, { onDelete: 'cascade' }),
    /** The graph-local step id, e.g. `enter_request_number`. */
    stepId: text('step_id').notNull(),
    bindingNumber: integer('binding_number').notNull(),
    binding: jsonb('binding').$type<ExecutionBinding>().notNull(),
    bindingSha256: text('binding_sha256').notNull(),
    state: text('state').$type<BindingState>().notNull().default('draft'),
    /**
     * The revision on screen when this was recorded.
     *
     * `set null` rather than `cascade`: losing the revision must not delete the
     * mapping, because the mapping is still what a human approved.
     */
    capturedAgainstRevisionId: opaqueId<SopRevisionId>('captured_against_revision_id').references(
      () => sopGraphRevisions.id,
      { onDelete: 'set null' },
    ),
    parentBindingId: opaqueId<ExecutionBindingId>('parent_binding_id').references(
      (): AnyPgColumn => executionBindings.id,
      { onDelete: 'set null' },
    ),
    supersededByBindingId: opaqueId<ExecutionBindingId>('superseded_by_binding_id').references(
      (): AnyPgColumn => executionBindings.id,
      { onDelete: 'set null' },
    ),
    reviewedAt: timestamptz('reviewed_at'),
    /** Why a reviewer approved or rejected. Never a secret or page content. */
    reviewNote: text('review_note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('execution_bindings_document_step_number_unique').on(
      table.documentId,
      table.stepId,
      table.bindingNumber,
    ),
    index('execution_bindings_document_id_idx').on(table.documentId),
    index('execution_bindings_state_idx').on(table.state),
    check('execution_bindings_state_check', inValues(table.state, BINDING_STATES)),
    check('execution_bindings_binding_sha256_check', isSha256(table.bindingSha256)),
    check('execution_bindings_binding_number_check', sql`${table.bindingNumber} >= 1`),
    // A reviewed binding always records when it was reviewed.
    check(
      'execution_bindings_reviewed_at_check',
      sql`${table.state} NOT IN ('approved', 'rejected') OR ${table.reviewedAt} IS NOT NULL`,
    ),
  ],
);

export type ExecutionBindingRow = typeof executionBindings.$inferSelect;
export type NewExecutionBindingRow = typeof executionBindings.$inferInsert;
