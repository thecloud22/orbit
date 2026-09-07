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
  /**
   * Retires the agent from the active catalog (ADR-026). Every version
   * published under it, and every run and its evidence, is untouched — this
   * sets one timestamp on the identity row, nothing on `agent_versions`.
   * Returns `null` for an id that does not exist rather than throwing, so a
   * route can turn that into a 404 without a separate existence check.
   */
  archive(id: AgentId): Promise<AgentRecord | null>;
  /** Reverses `archive`. Returns `null` for an id that does not exist. */
  restore(id: AgentId): Promise<AgentRecord | null>;
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

    async archive(id) {
      const [row] = await executor
        .update(agents)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(agents.id, id))
        .returning();

      return row === undefined ? null : toAgentRecord(row);
    },

    async restore(id) {
      const [row] = await executor
        .update(agents)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(eq(agents.id, id))
        .returning();

      return row === undefined ? null : toAgentRecord(row);
    },
  };
}
