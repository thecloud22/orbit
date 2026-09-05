import { pgTable, text } from 'drizzle-orm/pg-core';
import type { AgentId } from '@orbit/contracts';

import { createdAt, opaqueId, updatedAt } from './columns';

/**
 * Logical agent identity, separate from any version of it (ADR-005). An agent
 * outlives every version published under it, which is why runs pin a version
 * and never an agent.
 */
export const agents = pgTable('agents', {
  id: opaqueId<AgentId>('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type AgentRow = typeof agents.$inferSelect;
export type NewAgentRow = typeof agents.$inferInsert;
