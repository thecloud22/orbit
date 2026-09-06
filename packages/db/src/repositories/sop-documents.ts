import { newSopDocumentId, type SopDocumentId } from '@orbit/contracts';
import { asc, desc, eq } from 'drizzle-orm';

import type { Executor } from '../client';
import { toSopDocumentRecord, type SopDocumentRecord } from '../mappers';
import { sopDocuments, sopGraphRevisions, type SopRevisionState } from '../schema';

export interface CreateSopDocumentInput {
  readonly title: string;
  /** The free-form SOP as authored. Cannot be changed afterwards. */
  readonly sourceText: string;
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
}

/**
 * SOP documents.
 *
 * There is no `updateSourceText`, and that absence is the enforcement: the
 * original text is what a reviewer's approval refers back to, so it is written
 * once. Re-authoring means a new document.
 */
export interface SopDocumentRepository {
  create(input: CreateSopDocumentInput): Promise<SopDocumentRecord>;
  findById(id: SopDocumentId): Promise<SopDocumentRecord | null>;
  list(): Promise<readonly SopDocumentRecord[]>;
  /** The document plus its derived current status. */
  summarize(id: SopDocumentId): Promise<SopDocumentSummary | null>;
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
      const rows = await executor.select().from(sopDocuments).orderBy(desc(sopDocuments.createdAt));
      return rows.map(toSopDocumentRecord);
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

      const all = await executor
        .select({ state: sopGraphRevisions.state, number: sopGraphRevisions.revisionNumber })
        .from(sopGraphRevisions)
        .where(eq(sopGraphRevisions.documentId, id))
        .orderBy(asc(sopGraphRevisions.revisionNumber));

      const live = await executor
        .select({ state: sopGraphRevisions.state })
        .from(sopGraphRevisions)
        .where(eq(sopGraphRevisions.documentId, id))
        .orderBy(desc(sopGraphRevisions.revisionNumber));

      const current = live.find((revision) => revision.state !== 'superseded');

      return {
        ...toSopDocumentRecord(row),
        status: current?.state ?? null,
        revisionCount: all.length,
      };
    },
  };
}
