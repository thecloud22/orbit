import type {
  AgentVersionId,
  ModelRequestId,
  ModelUsageId,
  RunId,
  SopDocumentId,
} from '@orbit/contracts';

import type { ModelUsageRow } from '../schema';

/** One recorded model call. */
export interface ModelUsageRecord {
  readonly id: ModelUsageId;
  readonly requestId: ModelRequestId;
  readonly documentId: SopDocumentId | null;
  /** Set for a judged decision made during a run; null for a drafting call. */
  readonly runId: RunId | null;
  readonly agentVersionId: AgentVersionId | null;
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** An estimate in millionths of a dollar. Never a bill. */
  readonly estimatedCostMicroUsd: number;
  readonly attempt: number;
  readonly createdAt: Date;
}

export function toModelUsageRecord(row: ModelUsageRow): ModelUsageRecord {
  return {
    id: row.id,
    requestId: row.requestId,
    documentId: row.documentId,
    runId: row.runId,
    agentVersionId: row.agentVersionId,
    provider: row.provider,
    model: row.model,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    estimatedCostMicroUsd: row.estimatedCostMicroUsd,
    attempt: row.attempt,
    createdAt: row.createdAt,
  };
}
