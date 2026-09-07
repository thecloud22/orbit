import {
  newModelUsageId,
  type ModelRequestId,
  type ModelUsageId,
  type SopDocumentId,
} from '@orbit/contracts';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import type { Executor } from '../client';
import { toModelUsageRecord, type ModelUsageRecord } from '../mappers';
import { modelUsage } from '../schema';

export interface RecordModelUsageInput {
  readonly requestId: ModelRequestId;
  /** Absent for the first call of a document that does not exist yet. */
  readonly documentId?: SopDocumentId;
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostMicroUsd: number;
  readonly attempt: number;
  readonly id?: ModelUsageId;
}

/** Tokens and estimated cost over some set of calls. */
export interface ModelUsageTotals {
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly estimatedCostMicroUsd: number;
}

/**
 * The model-spend ledger.
 *
 * Append and sum, and nothing else. There is deliberately no update, no delete
 * and no stored running total: every budget check is a sum over the rows, so
 * the number a budget is enforced against and the number a person is shown come
 * from the same place and cannot disagree.
 *
 * `attachDocument` is the one write that touches an existing row, and it only
 * ever fills in a null. The first call of a brand-new document happens before
 * the document exists, so its row is written with no document and adopted once
 * one lands. It cannot move a row from one document to another.
 */
export interface ModelUsageRepository {
  record(input: RecordModelUsageInput): Promise<ModelUsageRecord>;
  /** Every call in the deployment. The global scope. */
  totals(): Promise<ModelUsageTotals>;
  /** Every call for one document. The per-agent scope at drafting time. */
  totalsForDocument(documentId: SopDocumentId): Promise<ModelUsageTotals>;
  /** Every call of one Generate request. The per-run scope. */
  totalsForRequest(requestId: ModelRequestId): Promise<ModelUsageTotals>;
  listForDocument(documentId: SopDocumentId): Promise<readonly ModelUsageRecord[]>;
  /** Adopts the unattributed rows of one request into the document they made. */
  attachDocument(requestId: ModelRequestId, documentId: SopDocumentId): Promise<number>;
}

const EMPTY: ModelUsageTotals = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  estimatedCostMicroUsd: 0,
};

export function createModelUsageRepository(executor: Executor): ModelUsageRepository {
  async function sumWhere(where: ReturnType<typeof eq> | undefined): Promise<ModelUsageTotals> {
    const query = executor
      .select({
        calls: sql<string>`count(*)`,
        inputTokens: sql<string>`coalesce(sum(${modelUsage.inputTokens}), 0)`,
        outputTokens: sql<string>`coalesce(sum(${modelUsage.outputTokens}), 0)`,
        cost: sql<string>`coalesce(sum(${modelUsage.estimatedCostMicroUsd}), 0)`,
      })
      .from(modelUsage);

    const [row] = await (where === undefined ? query : query.where(where));

    if (row === undefined) {
      return EMPTY;
    }

    // PostgreSQL returns count and sum as bigint/numeric, which the driver
    // hands back as strings. Parsed here rather than left to a caller, which
    // would otherwise be comparing a budget against "1200".
    const inputTokens = Number(row.inputTokens);
    const outputTokens = Number(row.outputTokens);

    return {
      calls: Number(row.calls),
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      estimatedCostMicroUsd: Number(row.cost),
    };
  }

  return {
    async record(input) {
      const [row] = await executor
        .insert(modelUsage)
        .values({
          id: input.id ?? newModelUsageId(),
          requestId: input.requestId,
          documentId: input.documentId ?? null,
          provider: input.provider,
          model: input.model,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          estimatedCostMicroUsd: input.estimatedCostMicroUsd,
          attempt: input.attempt,
        })
        .returning();

      return toModelUsageRecord(row!);
    },

    async totals() {
      return sumWhere(undefined);
    },

    async totalsForDocument(documentId) {
      return sumWhere(eq(modelUsage.documentId, documentId));
    },

    async totalsForRequest(requestId) {
      return sumWhere(eq(modelUsage.requestId, requestId));
    },

    async listForDocument(documentId) {
      const rows = await executor
        .select()
        .from(modelUsage)
        .where(eq(modelUsage.documentId, documentId))
        .orderBy(asc(modelUsage.createdAt), asc(modelUsage.id));

      return rows.map(toModelUsageRecord);
    },

    async attachDocument(requestId, documentId) {
      const rows = await executor
        .update(modelUsage)
        .set({ documentId })
        .where(and(eq(modelUsage.requestId, requestId), isNull(modelUsage.documentId)))
        .returning({ id: modelUsage.id });

      return rows.length;
    },
  };
}
