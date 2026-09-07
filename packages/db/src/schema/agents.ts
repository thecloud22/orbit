import { pgTable, text } from 'drizzle-orm/pg-core';
import type { AgentId } from '@orbit/contracts';

import { createdAt, opaqueId, timestamptz, updatedAt } from './columns';

/**
 * Logical agent identity, separate from any version of it (ADR-005). An agent
 * outlives every version published under it, which is why runs pin a version
 * and never an agent.
 *
 * `archivedAt` retires the agent from the active catalog without touching a
 * single `agent_versions` row (ADR-026). This table is deliberately mutable —
 * ADR-014's immutability guarantee is scoped to a version's own content, never
 * to the identity record that outlives every version published under it.
 */
export const agents = pgTable('agents', {
  id: opaqueId<AgentId>('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  archivedAt: timestamptz('archived_at'),
});

export type AgentRow = typeof agents.$inferSelect;
export type NewAgentRow = typeof agents.$inferInsert;
