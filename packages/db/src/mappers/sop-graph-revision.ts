import type { SopDocumentId, SopRevisionId } from '@orbit/contracts';
import { parseSopGraphDocument, type SopGraph } from '@orbit/sop-graph';

import { sha256Of } from '../checksum';
import { DatabaseIntegrityError } from '../errors';
import type { SopGraphRevisionRow, SopRevisionProvenance, SopRevisionState } from '../schema';

export interface SopGraphRevisionRecord {
  readonly id: SopRevisionId;
  readonly documentId: SopDocumentId;
  readonly revisionNumber: number;
  /** Re-validated on every read; never returned as an unchecked JSON blob. */
  readonly graph: SopGraph;
  readonly graphSha256: string;
  readonly state: SopRevisionState;
  readonly provenance: SopRevisionProvenance;
  readonly parentRevisionId: SopRevisionId | null;
  readonly supersededByRevisionId: SopRevisionId | null;
  readonly reviewedAt: Date | null;
  readonly reviewNote: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Turns a stored row back into a validated revision.
 *
 * The graph is re-parsed and its checksum recomputed on every read. A revision
 * that no longer validates, or whose bytes no longer match the checksum written
 * when it was created, is a corrupted record of what a human reviewed — it
 * raises rather than being handed back as if it were the approved document.
 *
 * This mirrors how `agent_versions` treats its own IR, and for the same reason:
 * an artifact whose meaning can drift silently cannot serve as evidence of
 * anything.
 */
export function toSopGraphRevisionRecord(row: SopGraphRevisionRow): SopGraphRevisionRecord {
  const parsed = parseSopGraphDocument(row.graph);

  if (!parsed.ok) {
    throw new DatabaseIntegrityError(
      `SOP graph revision ${row.id} holds a graph that no longer validates: ${JSON.stringify(parsed.issues)}`,
    );
  }

  const checksum = sha256Of(row.graph);

  if (checksum !== row.graphSha256) {
    throw new DatabaseIntegrityError(
      `SOP graph revision ${row.id} has a checksum mismatch: stored ${row.graphSha256}, computed ${checksum}. The stored graph has been altered.`,
    );
  }

  return {
    id: row.id,
    documentId: row.documentId,
    revisionNumber: row.revisionNumber,
    graph: parsed.graph,
    graphSha256: row.graphSha256,
    state: row.state,
    provenance: row.provenance,
    parentRevisionId: row.parentRevisionId,
    supersededByRevisionId: row.supersededByRevisionId,
    reviewedAt: row.reviewedAt,
    reviewNote: row.reviewNote,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
