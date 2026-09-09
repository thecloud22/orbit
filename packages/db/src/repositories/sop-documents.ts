import { newSopDocumentId, type SopDocumentId } from '@orbit/contracts';
import { desc, eq, isNull } from 'drizzle-orm';

import type { Executor } from '../client';
import { RecordNotFoundError } from '../errors';
import { toSopDocumentRecord, type SopDocumentRecord } from '../mappers';
import { sopDocuments, sopGraphRevisions, type SopRevisionState } from '../schema';

export interface CreateSopDocumentInput {
  readonly title: string;
  /** The free-form SOP as authored. Cannot be changed afterwards. */
  readonly sourceText: string;
  /** Opt-in at creation; defaults to off, which is what every caller uses. */
  readonly recoveryEnabled?: boolean;
  readonly id?: SopDocumentId;
}

/**
 * A document's status is **derived**, never stored.
 *
 * It is the state of the newest revision that has not been superseded. Storing
 * it alongside the revision's own state would create two records of one fact,
 * and the interesting question would immediately become which of them is right.
 */
export interface SopDocumentSummary extends SopDocumentRecord {
  readonly status: SopRevisionState | null;
  readonly revisionCount: number;
  /** Steps in the current revision's graph; 0 when there is no live revision. */
  readonly stepCount: number;
}

/**
 * SOP documents.
 *
 * There is no `updateSourceText`, and that absence is the enforcement: the
 * original text is what a reviewer's approval refers back to, so it is written
 * once. Re-authoring means a new document.
 *
 * `setRecoveryEnabled` is the one mutable thing about a document, and it is a
 * *grant* rather than content: it says whether Orbit may propose repairs for
 * agents published from it (ADR-033). It changes nothing about any Agent
 * Version already published, because those carry their own `permissions` and
 * are immutable — which is exactly why the grant is compiled into the IR rather
 * than read live at run time.
 */
export interface SopDocumentRepository {
  create(input: CreateSopDocumentInput): Promise<SopDocumentRecord>;
  findById(id: SopDocumentId): Promise<SopDocumentRecord | null>;
  /** Documents still being worked on. A discarded one is not one of them. */
  list(): Promise<readonly SopDocumentRecord[]>;
  /**
   * Retires a document from the authoring list.
   *
   * A timestamp, never a delete: revisions and bindings point at this row, and
   * "what was this workflow written from?" has to stay answerable. Returns null
   * when there is no such document, so a caller can tell "already gone" from
   * "never existed".
   */
  discard(id: SopDocumentId): Promise<SopDocumentRecord | null>;
  /** The document plus its derived current status. */
  summarize(id: SopDocumentId): Promise<SopDocumentSummary | null>;
  setRecoveryEnabled(id: SopDocumentId, enabled: boolean): Promise<SopDocumentRecord>;
}

export function createSopDocumentRepository(executor: Executor): SopDocumentRepository {
  return {
    async create(input) {
      const [row] = await executor
        .insert(sopDocuments)
        .values({
          id: input.id ?? newSopDocumentId(),
          title: input.title,
          sourceText: input.sourceText,
          ...(input.recoveryEnabled === undefined
            ? {}
            : { recoveryEnabled: input.recoveryEnabled }),
        })
        .returning();

      return toSopDocumentRecord(row!);
    },

    async findById(id) {
      const [row] = await executor
        .select()
        .from(sopDocuments)
        .where(eq(sopDocuments.id, id))
        .limit(1);
      return row === undefined ? null : toSopDocumentRecord(row);
    },

    async list() {
      // Filtered here rather than at each call site, so a discarded document
      // cannot reappear in one list because somebody forgot the clause.
      // `findById` deliberately still returns it: a link someone kept should
      // open the document and say it was discarded, not report it missing.
      const rows = await executor
        .select()
        .from(sopDocuments)
        .where(isNull(sopDocuments.discardedAt))
        .orderBy(desc(sopDocuments.createdAt));
      return rows.map(toSopDocumentRecord);
    },

    async discard(id) {
      const [row] = await executor
        .update(sopDocuments)
        .set({ discardedAt: new Date(), updatedAt: new Date() })
        .where(eq(sopDocuments.id, id))
        .returning();

      return row === undefined ? null : toSopDocumentRecord(row);
    },

    async setRecoveryEnabled(id, enabled) {
      const [row] = await executor
        .update(sopDocuments)
        .set({ recoveryEnabled: enabled, updatedAt: new Date() })
        .where(eq(sopDocuments.id, id))
        .returning();

      if (row === undefined) {
        throw new RecordNotFoundError(`SOP document ${id} does not exist.`);
      }

      return toSopDocumentRecord(row);
    },

    async summarize(id) {
      const [row] = await executor
        .select()
        .from(sopDocuments)
        .where(eq(sopDocuments.id, id))
        .limit(1);

      if (row === undefined) {
        return null;
      }

      // One pass over the document's revisions, newest first. This replaced two
      // queries that scanned the same rows for different columns; the graph
      // rides along so a step count costs no extra round trip. Revisions are
      // few by design — each one is a human edit — so loading them together is
      // cheaper than fetching the current graph separately.
      const revisions = await executor
        .select({
          state: sopGraphRevisions.state,
          graph: sopGraphRevisions.graph,
        })
        .from(sopGraphRevisions)
        .where(eq(sopGraphRevisions.documentId, id))
        .orderBy(desc(sopGraphRevisions.revisionNumber));

      const current = revisions.find((revision) => revision.state !== 'superseded');

      return {
        ...toSopDocumentRecord(row),
        status: current?.state ?? null,
        revisionCount: revisions.length,
        // A count for display, read straight off the stored document rather
        // than through the validating mapper: a summary must not fail to render
        // because one revision somewhere no longer parses.
        stepCount: Array.isArray(current?.graph.steps) ? current.graph.steps.length : 0,
      };
    },
  };
}
