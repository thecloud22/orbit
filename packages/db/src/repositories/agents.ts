import { newAgentId, type AgentId } from '@orbit/contracts';
import { asc, eq } from 'drizzle-orm';

import type { Executor } from '../client';
import { toAgentRecord, type AgentRecord } from '../mappers';
import { agents } from '../schema';

export interface CreateAgentInput {
  readonly name: string;
  readonly description?: string;
  /** Supplied when the identity is meaningful, such as the seeded agent's own IR id. */
  readonly id?: AgentId;
}

export interface AgentRepository {
  create(input: CreateAgentInput): Promise<AgentRecord>;
  /** Idempotent for seeding: creates the agent, or refreshes its display fields. */
  upsert(input: CreateAgentInput & { readonly id: AgentId }): Promise<AgentRecord>;
  findById(id: AgentId): Promise<AgentRecord | null>;
  list(): Promise<readonly AgentRecord[]>;
}

export function createAgentRepository(executor: Executor): AgentRepository {
  return {
    async create(input) {
      const [row] = await executor
        .insert(agents)
        .values({
          id: input.id ?? newAgentId(),
          name: input.name,
          description: input.description ?? null,
        })
        .returning();

      return toAgentRecord(row!);
    },

    async upsert(input) {
      const [row] = await executor
        .insert(agents)
        .values({
          id: input.id,
          name: input.name,
          description: input.description ?? null,
        })
        .onConflictDoUpdate({
          target: agents.id,
          set: { name: input.name, description: input.description ?? null, updatedAt: new Date() },
        })
        .returning();

      return toAgentRecord(row!);
    },

    async findById(id) {
      const [row] = await executor.select().from(agents).where(eq(agents.id, id)).limit(1);
      return row === undefined ? null : toAgentRecord(row);
    },

    async list() {
      const rows = await executor.select().from(agents).orderBy(asc(agents.name));
      return rows.map(toAgentRecord);
    },
  };
}
