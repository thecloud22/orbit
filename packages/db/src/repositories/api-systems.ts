import { newApiSystemId, type ApiSystemId } from '@orbit/contracts';
import { asc, eq } from 'drizzle-orm';

import type { Executor } from '../client';
import { apiSystems, type ApiSystemRow } from '../schema';

export interface CreateApiSystemInput {
  readonly catalogId: string;
  readonly name: string;
  readonly specText: string;
  readonly authScheme: 'none' | 'bearer' | 'basic';
  /** A credential *name*, never a value (ADR-038). */
  readonly credentialRef?: string;
  readonly authHeaderName?: string;
}

/**
 * Registered API contracts.
 *
 * Ordinary mutable configuration, unlike almost everything else in this schema:
 * a contract is a fact about a service that changes when the service does, and
 * re-registering one must not disturb any Agent Version already published from
 * it. The *grant* a version carries is compiled in and immutable (ADR-005), so
 * editing a system here can never widen what a running agent may call.
 */
export function createApiSystemsRepository(executor: Executor) {
  return {
    async list(): Promise<readonly ApiSystemRow[]> {
      return executor.select().from(apiSystems).orderBy(asc(apiSystems.name));
    },

    async byCatalogId(catalogId: string): Promise<ApiSystemRow | undefined> {
      const [found] = await executor
        .select()
        .from(apiSystems)
        .where(eq(apiSystems.catalogId, catalogId))
        .limit(1);
      return found;
    },

    async create(input: CreateApiSystemInput): Promise<ApiSystemRow> {
      const [created] = await executor
        .insert(apiSystems)
        .values({
          id: newApiSystemId(),
          catalogId: input.catalogId,
          name: input.name,
          specText: input.specText,
          authScheme: input.authScheme,
          credentialRef: input.credentialRef ?? null,
          authHeaderName: input.authHeaderName ?? null,
        })
        .returning();

      if (created === undefined) {
        throw new Error('the API system row was not returned after insert');
      }

      return created;
    },

    async remove(id: ApiSystemId): Promise<boolean> {
      const removed = await executor.delete(apiSystems).where(eq(apiSystems.id, id)).returning();
      return removed.length > 0;
    },
  };
}

export type ApiSystemsRepository = ReturnType<typeof createApiSystemsRepository>;
