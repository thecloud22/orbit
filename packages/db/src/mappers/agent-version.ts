import { parseAgentIrDocument, type AgentIr } from '@orbit/agent-ir';
import type { AgentId, AgentVersionId } from '@orbit/contracts';

import { sha256Of } from '../checksum';
import { DatabaseIntegrityError } from '../errors';
import type { AgentVersionRow, LIFECYCLE_STATUSES, TRUST_TIERS } from '../schema';

export interface AgentVersionRecord {
  readonly id: AgentVersionId;
  readonly agentId: AgentId;
  readonly version: string;
  readonly name: string;
  readonly description: string | null;
  readonly schemaVersion: string;
  readonly lifecycleStatus: (typeof LIFECYCLE_STATUSES)[number];
  readonly trustTier: (typeof TRUST_TIERS)[number];
  readonly sourceSopId: string;
  readonly sourceSopVersion: string;
  /** Re-validated on every read; never returned as an unchecked JSON blob. */
  readonly agentIr: AgentIr;
  readonly irSha256: string;
  readonly createdAt: Date;
  readonly publishedAt: Date | null;
}

/** What Watchtower's agent list needs, without shipping the whole IR. */
export interface AgentVersionSummary {
  readonly id: AgentVersionId;
  readonly agentId: AgentId;
  readonly name: string;
  readonly version: string;
  readonly description: string | null;
  readonly lifecycleStatus: (typeof LIFECYCLE_STATUSES)[number];
  readonly inputs: AgentIr['inputs'];
}

/**
 * Turns a stored row back into a validated Agent Version.
 *
 * The IR is re-parsed and its checksum re-computed on every read. A row that no
 * longer validates, or whose bytes no longer match the checksum recorded when
 * it was published, is a corrupted immutable version — it raises rather than
 * being handed to a runtime that would execute it.
 */
export function toAgentVersionRecord(row: AgentVersionRow): AgentVersionRecord {
  const parsed = parseAgentIrDocument(row.agentIr);

  if (!parsed.ok) {
    throw new DatabaseIntegrityError(
      `Agent version ${row.id} holds Agent IR that no longer validates: ${JSON.stringify(parsed.issues)}`,
    );
  }

  const checksum = sha256Of(row.agentIr);

  if (checksum !== row.irSha256) {
    throw new DatabaseIntegrityError(
      `Agent version ${row.id} has a checksum mismatch: stored ${row.irSha256}, computed ${checksum}. The immutable Agent IR has been altered.`,
    );
  }

  return {
    id: row.id,
    agentId: row.agentId,
    version: row.version,
    name: row.name,
    description: row.description,
    schemaVersion: row.schemaVersion,
    lifecycleStatus: row.lifecycleStatus,
    trustTier: row.trustTier,
    sourceSopId: row.sourceSopId,
    sourceSopVersion: row.sourceSopVersion,
    agentIr: parsed.agentIr,
    irSha256: row.irSha256,
    createdAt: row.createdAt,
    publishedAt: row.publishedAt,
  };
}

export function toAgentVersionSummary(record: AgentVersionRecord): AgentVersionSummary {
  return {
    id: record.id,
    agentId: record.agentId,
    name: record.name,
    version: record.version,
    description: record.description,
    lifecycleStatus: record.lifecycleStatus,
    inputs: record.agentIr.inputs,
  };
}
