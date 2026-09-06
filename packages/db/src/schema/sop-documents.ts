import type { SopDocumentId } from '@orbit/contracts';
import { pgTable, text } from 'drizzle-orm/pg-core';

import { createdAt, opaqueId, updatedAt } from './columns';

/**
 * The authoring container for one SOP.
 *
 * `sourceText` is what the user originally wrote, and the repository exposes no
 * way to change it. "What did the user originally write?" is one of the
 * questions Phase 2 must always be able to answer, and it stops being
 * answerable the moment the original can be edited in place. Rewording an SOP
 * produces a new revision — or a new document — never a quiet overwrite of the
 * thing the review was based on.
 *
 * There is deliberately no lifecycle column here. Lifecycle belongs to a
 * revision, and a document's current status is derived from its newest
 * non-superseded revision so the two can never disagree.
 */
export const sopDocuments = pgTable('sop_documents', {
  id: opaqueId<SopDocumentId>('id').primaryKey(),
  title: text('title').notNull(),
  /** The free-form SOP as authored. Immutable. */
  sourceText: text('source_text').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type SopDocumentRow = typeof sopDocuments.$inferSelect;
export type NewSopDocumentRow = typeof sopDocuments.$inferInsert;
