import type {
  AgentVersionId,
  BindingRecoveryProposalId,
  ExecutionBindingId,
  RunId,
  SopDocumentId,
} from '@orbit/contracts';
import { parseExecutionBinding, type ExecutionBinding } from '@orbit/execution-mapping';

import { sha256Of } from '../checksum';
import { DatabaseIntegrityError } from '../errors';
import type { BindingRecoveryProposalRow, RecoveryProposalState } from '../schema';

export interface BindingRecoveryProposalRecord {
  readonly id: BindingRecoveryProposalId;
  readonly documentId: SopDocumentId;
  readonly stepId: string;
  readonly proposedForBindingId: ExecutionBindingId;
  readonly observedInRunId: RunId | null;
  readonly observedInAgentVersionId: AgentVersionId | null;
  readonly state: RecoveryProposalState;
  /** Re-validated on every read; never returned as an unchecked JSON blob. */
  readonly proposedBinding: ExecutionBinding;
  readonly proposedBindingSha256: string;
  readonly diagnosis: Record<string, unknown>;
  readonly deterministic: boolean;
  readonly resultingBindingId: ExecutionBindingId | null;
  readonly resolutionNote: string | null;
  readonly resolvedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Turns a stored proposal back into a validated one.
 *
 * Re-parsed and re-checksummed exactly as a stored binding is, and for the
 * stronger reason: accepting a proposal turns this document into a binding a
 * real browser acts through. A proposal whose bytes have drifted from what was
 * proposed is not something to offer a reviewer an accept button for.
 */
export function toBindingRecoveryProposalRecord(
  row: BindingRecoveryProposalRow,
): BindingRecoveryProposalRecord {
  const parsed = parseExecutionBinding(row.proposedBinding);

  if (!parsed.ok) {
    throw new DatabaseIntegrityError(
      `Recovery proposal ${row.id} holds a binding that no longer validates: ${JSON.stringify(parsed.issues)}`,
    );
  }

  const checksum = sha256Of(row.proposedBinding);

  if (checksum !== row.proposedBindingSha256) {
    throw new DatabaseIntegrityError(
      `Recovery proposal ${row.id} has a checksum mismatch: stored ${row.proposedBindingSha256}, computed ${checksum}. The stored proposal has been altered.`,
    );
  }

  return {
    id: row.id,
    documentId: row.documentId,
    stepId: row.stepId,
    proposedForBindingId: row.proposedForBindingId,
    observedInRunId: row.observedInRunId,
    observedInAgentVersionId: row.observedInAgentVersionId,
    state: row.state,
    proposedBinding: parsed.binding,
    proposedBindingSha256: row.proposedBindingSha256,
    diagnosis: row.diagnosis,
    deterministic: row.deterministic,
    resultingBindingId: row.resultingBindingId,
    resolutionNote: row.resolutionNote,
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
