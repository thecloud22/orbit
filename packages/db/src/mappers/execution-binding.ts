import type { ExecutionBindingId, SopDocumentId, SopRevisionId } from '@orbit/contracts';
import { parseExecutionBinding, type ExecutionBinding } from '@orbit/execution-mapping';

import { sha256Of } from '../checksum';
import { DatabaseIntegrityError } from '../errors';
import type { BindingState, ExecutionBindingRow } from '../schema';

export interface ExecutionBindingRecord {
  readonly id: ExecutionBindingId;
  readonly documentId: SopDocumentId;
  readonly stepId: string;
  readonly bindingNumber: number;
  /** Re-validated on every read; never returned as an unchecked JSON blob. */
  readonly binding: ExecutionBinding;
  readonly bindingSha256: string;
  readonly state: BindingState;
  readonly capturedAgainstRevisionId: SopRevisionId | null;
  readonly parentBindingId: ExecutionBindingId | null;
  readonly supersededByBindingId: ExecutionBindingId | null;
  readonly reviewedAt: Date | null;
  readonly reviewNote: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Turns a stored row back into a validated binding.
 *
 * Re-parsed and re-checksummed on every read, exactly as `agent_versions` and
 * `sop_graph_revisions` already are. A binding decides what a real browser
 * clicks, so one whose bytes have drifted from what was approved is not a
 * binding to be trusted with that — it raises rather than being handed back.
 */
export function toExecutionBindingRecord(row: ExecutionBindingRow): ExecutionBindingRecord {
  const parsed = parseExecutionBinding(row.binding);

  if (!parsed.ok) {
    throw new DatabaseIntegrityError(
      `Execution binding ${row.id} holds a binding that no longer validates: ${JSON.stringify(parsed.issues)}`,
    );
  }

  const checksum = sha256Of(row.binding);

  if (checksum !== row.bindingSha256) {
    throw new DatabaseIntegrityError(
      `Execution binding ${row.id} has a checksum mismatch: stored ${row.bindingSha256}, computed ${checksum}. The stored binding has been altered.`,
    );
  }

  return {
    id: row.id,
    documentId: row.documentId,
    stepId: row.stepId,
    bindingNumber: row.bindingNumber,
    binding: parsed.binding,
    bindingSha256: row.bindingSha256,
    state: row.state,
    capturedAgainstRevisionId: row.capturedAgainstRevisionId,
    parentBindingId: row.parentBindingId,
    supersededByBindingId: row.supersededByBindingId,
    reviewedAt: row.reviewedAt,
    reviewNote: row.reviewNote,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
