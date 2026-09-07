import type { AgentId } from '@orbit/contracts';

import type { AgentRow } from '../schema';

export interface AgentRecord {
  readonly id: AgentId;
  readonly name: string;
  readonly description: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Set once the agent is retired from the active catalog (ADR-026). */
  readonly archivedAt: Date | null;
}

export function toAgentRecord(row: AgentRow): AgentRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  };
}
