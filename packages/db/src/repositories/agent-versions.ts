import type { AgentIr } from '@orbit/agent-ir';
import {
  newAgentVersionId,
  type AgentId,
  type AgentIrCandidateId,
  type AgentVersionId,
} from '@orbit/contracts';
import { and, asc, eq } from 'drizzle-orm';

import { sha256Of } from '../checksum';
import type { Executor } from '../client';
import {
  toAgentVersionRecord,
  toAgentVersionSummary,
  type AgentVersionRecord,
  type AgentVersionSummary,
} from '../mappers';
import { agentVersions } from '../schema';

export interface CreateAgentVersionInput {
  /** Already validated by @orbit/agent-ir; this repository never stores unvalidated IR. */
  readonly agentIr: AgentIr;
  readonly id?: AgentVersionId;
  readonly publishedAt?: Date;
  /**
   * The approved candidate this version was published from (sub-phase 2.6).
   *
   * Absent for the seeded agent, which came from a fixture. Recorded at
   * creation because there is no later opportunity: this repository has no
   * update path, and adding one to attach provenance afterwards would be the
   * mutation ADR-014 exists to prevent.
   */
  readonly publishedFromCandidateId?: AgentIrCandidateId;
}

/**
 * Agent Versions are immutable (ADR-005).
 *
 * This interface has no update, publish, patch, or delete method, and that is
 * the enforcement: a run's evidence is meaningless if the definition it
 * executed can be reinterpreted afterwards. Correcting a workflow means
 * publishing a new version, never editing this one. Database-level enforcement
 * is deferred to production hardening (ADR-014); the stored checksum means any
 * out-of-band edit is detected on the next read.
 */
export interface AgentVersionRepository {
  create(input: CreateAgentVersionInput): Promise<AgentVersionRecord>;
  findById(id: AgentVersionId): Promise<AgentVersionRecord | null>;
  findByAgentAndVersion(agentId: AgentId, version: string): Promise<AgentVersionRecord | null>;
  listPublished(): Promise<readonly AgentVersionSummary[]>;
  listByAgent(agentId: AgentId): Promise<readonly AgentVersionRecord[]>;
}

export function createAgentVersionRepository(executor: Executor): AgentVersionRepository {
  return {
    async create(input) {
      const { agentIr } = input;
      const document = { ...agentIr };

      const [row] = await executor
        .insert(agentVersions)
        .values({
          id: input.id ?? newAgentVersionId(),
          agentId: agentIr.id,
          version: agentIr.version,
          name: agentIr.name,
          description: agentIr.description ?? null,
          schemaVersion: agentIr.schemaVersion,
          lifecycleStatus: agentIr.lifecycle.status,
          trustTier: agentIr.lifecycle.trustTier,
          sourceSopId: agentIr.source.sopId,
          sourceSopVersion: agentIr.source.sopVersion,
          agentIr: document,
          irSha256: sha256Of(document),
          publishedFromCandidateId: input.publishedFromCandidateId ?? null,
          publishedAt:
            input.publishedAt ?? (agentIr.lifecycle.status === 'published' ? new Date() : null),
        })
        .returning();

      return toAgentVersionRecord(row!);
    },

    async findById(id) {
      const [row] = await executor
        .select()
        .from(agentVersions)
        .where(eq(agentVersions.id, id))
        .limit(1);

      return row === undefined ? null : toAgentVersionRecord(row);
    },

    async findByAgentAndVersion(agentId, version) {
      const [row] = await executor
        .select()
        .from(agentVersions)
        .where(and(eq(agentVersions.agentId, agentId), eq(agentVersions.version, version)))
        .limit(1);

      return row === undefined ? null : toAgentVersionRecord(row);
    },

    async listPublished() {
      const rows = await executor
        .select()
        .from(agentVersions)
        .where(eq(agentVersions.lifecycleStatus, 'published'))
        .orderBy(asc(agentVersions.name), asc(agentVersions.version));

      return rows.map((row) => toAgentVersionSummary(toAgentVersionRecord(row)));
    },

    async listByAgent(agentId) {
      const rows = await executor
        .select()
        .from(agentVersions)
        .where(eq(agentVersions.agentId, agentId))
        .orderBy(asc(agentVersions.version));

      return rows.map(toAgentVersionRecord);
    },
  };
}
