import { parseAgentIrDocument, type AgentIr } from '@orbit/agent-ir';
import type { AgentIrCandidateId, SopDocumentId, SopRevisionId } from '@orbit/contracts';

import { sha256Of } from '../checksum';
import { DatabaseIntegrityError } from '../errors';
import type { AgentIrCandidateRow, CandidateSandboxState, CandidateState } from '../schema';

export interface AgentIrCandidateRecord {
  readonly id: AgentIrCandidateId;
  readonly documentId: SopDocumentId;
  readonly revisionId: SopRevisionId;
  readonly candidateNumber: number;
  /** Re-validated on every read; never returned as an unchecked JSON blob. */
  readonly agentIr: AgentIr;
  readonly agentIrSha256: string;
  readonly outcomeMapping: Readonly<Record<string, string>>;
  readonly compiledFromBindingIds: readonly string[];
  readonly secretInputIds: readonly string[];
  readonly sandboxState: CandidateSandboxState;
  readonly sandboxNote: string | null;
  readonly state: CandidateState;
  readonly supersededByCandidateId: AgentIrCandidateId | null;
  readonly reviewedAt: Date | null;
  readonly reviewNote: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Turns a stored row back into validated candidate Agent IR.
 *
 * Re-parsed and re-checksummed on every read, exactly as `agent_versions`,
 * `sop_graph_revisions` and `execution_bindings` already are. This one is the
 * document that 2.6 turns into something a browser executes, so a candidate
 * whose bytes have drifted from what was approved is precisely the thing that
 * must never be handed back as though it were.
 */
export function toAgentIrCandidateRecord(row: AgentIrCandidateRow): AgentIrCandidateRecord {
  const parsed = parseAgentIrDocument(row.agentIr);

  if (!parsed.ok) {
    throw new DatabaseIntegrityError(
      `Agent IR candidate ${row.id} holds a document that no longer validates: ${JSON.stringify(parsed.issues)}`,
    );
  }

  const checksum = sha256Of(row.agentIr);

  if (checksum !== row.agentIrSha256) {
    throw new DatabaseIntegrityError(
      `Agent IR candidate ${row.id} has a checksum mismatch: stored ${row.agentIrSha256}, computed ${checksum}. The stored candidate has been altered.`,
    );
  }

  return {
    id: row.id,
    documentId: row.documentId,
    revisionId: row.revisionId,
    candidateNumber: row.candidateNumber,
    agentIr: parsed.agentIr,
    agentIrSha256: row.agentIrSha256,
    outcomeMapping: row.outcomeMapping,
    compiledFromBindingIds: row.compiledFromBindingIds,
    secretInputIds: row.secretInputIds,
    sandboxState: row.sandboxState,
    sandboxNote: row.sandboxNote,
    state: row.state,
    supersededByCandidateId: row.supersededByCandidateId,
    reviewedAt: row.reviewedAt,
    reviewNote: row.reviewNote,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
