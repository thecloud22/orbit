import type { SopDocumentId } from '@orbit/contracts';
import { boolean, pgTable, text } from 'drizzle-orm/pg-core';

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
  /**
   * Whether Orbit may propose a repair when an agent published from this
   * document hits UI drift (ADR-033).
   *
   * Off by default and opt-in per document, which is what makes it a grant
   * rather than a behaviour. It is carried into every Agent Version published
   * from the document as `permissions.recovery`, so the version a run executes
   * states its own authority and a run never has to consult the document to
   * know what it may do. Turning it off later cannot retract it from versions
   * already published — those are immutable (ADR-005) — which is why it is
   * expressed in the IR at all rather than read live.
   */
  recoveryEnabled: boolean('recovery_enabled').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type SopDocumentRow = typeof sopDocuments.$inferSelect;
export type NewSopDocumentRow = typeof sopDocuments.$inferInsert;
