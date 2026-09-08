import type {
  AgentVersionId,
  ModelRequestId,
  ModelUsageId,
  RunId,
  SopDocumentId,
} from '@orbit/contracts';
import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, pgTable, text } from 'drizzle-orm/pg-core';

import { agentVersions } from './agent-versions';
import { createdAt, opaqueId } from './columns';
import { runs } from './runs';
import { sopDocuments } from './sop-documents';

/**
 * One row per model call. Not per draft, and not per document.
 *
 * A draft costs up to two calls — an initial attempt and one repair — and a
 * budget that counted drafts would let the expensive case through free. The
 * ledger therefore records the unit that is actually billed, and every budget
 * scope is a sum over these rows rather than a counter kept somewhere else.
 * A counter would be a second source of truth that could drift from the
 * evidence; a sum cannot.
 *
 * Append-only by construction: the repository exposes no update and no delete.
 * A call that happened cannot un-happen, and a spend ledger that can be
 * rewritten is not a spend ledger.
 */
export const modelUsage = pgTable(
  'model_usage',
  {
    id: opaqueId<ModelUsageId>('id').primaryKey(),
    /**
     * The Generate request this call belongs to, which is the per-run scope.
     *
     * Several rows share one value: the initial attempt and its repair are one
     * request, and "per run" is a sum over them.
     */
    requestId: opaqueId<ModelRequestId>('request_id').notNull(),
    /**
     * The document the call was for, when there is one.
     *
     * Null for the first call of a brand-new document, because at the moment
     * the model is called nothing has been created yet — the document only
     * exists if the draft turns out to be valid. It is filled in afterwards
     * when the document lands, which is what makes the per-document scope
     * answerable for every call but the very first, and honest about that one.
     *
     * `set null` rather than `cascade`: deleting a document must not delete the
     * record that money was spent.
     */
    documentId: opaqueId<SopDocumentId>('document_id').references(() => sopDocuments.id, {
      onDelete: 'set null',
    }),
    /**
     * The run this call belongs to, when one does. The per-run scope.
     *
     * Null for a drafting call, which happens long before any run exists. Two
     * nullable columns rather than one polymorphic "scope id", because a query
     * that has to know which kind of id it is holding before it can sum is a
     * query that will eventually sum the wrong ones together.
     *
     * `set null` rather than `cascade`, exactly as `document_id` is: deleting a
     * run must not delete the record that money was spent.
     */
    runId: opaqueId<RunId>('run_id').references(() => runs.id, { onDelete: 'set null' }),
    /**
     * The agent version that made the call, when one did.
     *
     * The per-agent scope sums across versions by joining through this to the
     * agent, rather than capping each version separately: a cap that reset on
     * republish would be a cap anyone could clear by publishing.
     */
    agentVersionId: opaqueId<AgentVersionId>('agent_version_id').references(
      () => agentVersions.id,
      { onDelete: 'set null' },
    ),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    /**
     * An estimate, in micro-USD (millionths of a dollar).
     *
     * Integer micro-units rather than a float, because summing floats over a
     * ledger is how totals stop adding up. It is computed from rates held in
     * this deployment's own configuration and is never fetched from a price
     * list: nothing here is a bill, and every surface that shows it says so.
     */
    estimatedCostMicroUsd: bigint('estimated_cost_micro_usd', { mode: 'number' }).notNull(),
    /**
     * Which call of the request this was: 1 for the attempt, 2 for the repair.
     *
     * A judged decision has no repair — a second ask would be a second answer,
     * which a bounded decision must not have — so every judging row is 1.
     */
    attempt: integer('attempt').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index('model_usage_request_id_idx').on(table.requestId),
    index('model_usage_document_id_idx').on(table.documentId),
    index('model_usage_run_id_idx').on(table.runId),
    index('model_usage_agent_version_id_idx').on(table.agentVersionId),
    index('model_usage_created_at_idx').on(table.createdAt),
    check('model_usage_input_tokens_check', sql`${table.inputTokens} >= 0`),
    check('model_usage_output_tokens_check', sql`${table.outputTokens} >= 0`),
    check('model_usage_cost_check', sql`${table.estimatedCostMicroUsd} >= 0`),
    check('model_usage_attempt_check', sql`${table.attempt} >= 1`),
  ],
);

export type ModelUsageRow = typeof modelUsage.$inferSelect;
export type NewModelUsageRow = typeof modelUsage.$inferInsert;
