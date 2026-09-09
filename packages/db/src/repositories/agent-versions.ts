import type { AgentIr } from '@orbit/agent-ir';
import {
  newAgentVersionId,
  type AgentId,
  type AgentIrCandidateId,
  type AgentVersionId,
  type SopDocumentId,
} from '@orbit/contracts';
import { and, asc, eq, isNotNull } from 'drizzle-orm';

import { sha256Of } from '../checksum';
import type { Executor } from '../client';
import {
  toAgentVersionRecord,
  toAgentVersionSummary,
  type AgentVersionRecord,
  type AgentVersionSummary,
} from '../mappers';
import { agentIrCandidates, agents, agentVersions } from '../schema';

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
  /**
   * The published version each document has, if any, in one query.
   *
   * The join is document -> candidate -> version, because that is the only
   * path there is: a version records the candidate it was published from, and
   * a candidate records the document it was compiled from. Asking per document
   * would be two queries each, and the documents list asks for all of them at
   * once.
   *
   * It walks *every* candidate of a document rather than the current one, and
   * that difference is load-bearing rather than incidental. Compilation
   * supersedes the previous candidate before the new one is approved, so a
   * document whose latest publish attempt failed has a current candidate with
   * no version — while an earlier version is still running. Asking only the
   * current candidate reports that document as unpublished, which is how
   * discarding once let the source of a live agent leave the list.
   *
   * `documentId` narrows it to one document, for a caller that has one.
   */
  publishedByDocument(documentId?: SopDocumentId): Promise<ReadonlyMap<SopDocumentId, string>>;
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
      // Archiving (ADR-026) retires the agent, not any version row, so the
      // active catalog is filtered against `agents` here rather than by a
      // column on `agent_versions` — no published version is ever touched.
      const archivedAgentRows = await executor
        .select({ id: agents.id })
        .from(agents)
        .where(isNotNull(agents.archivedAt));
      const archivedAgentIds = new Set(archivedAgentRows.map((row) => row.id));

      const rows = await executor
        .select()
        .from(agentVersions)
        .where(eq(agentVersions.lifecycleStatus, 'published'))
        .orderBy(asc(agentVersions.name), asc(agentVersions.version));

      return rows
        .filter((row) => !archivedAgentIds.has(row.agentId))
        .map((row) => toAgentVersionSummary(toAgentVersionRecord(row)));
    },

    async publishedByDocument(documentId) {
      const published = eq(agentVersions.lifecycleStatus, 'published');

      const rows = await executor
        .select({
          documentId: agentIrCandidates.documentId,
          version: agentVersions.version,
        })
        .from(agentVersions)
        .innerJoin(
          agentIrCandidates,
          eq(agentVersions.publishedFromCandidateId, agentIrCandidates.id),
        )
        .where(
          documentId === undefined
            ? published
            : and(published, eq(agentIrCandidates.documentId, documentId)),
        )
        .orderBy(asc(agentVersions.createdAt));

      // Last write wins, so a document published more than once reports its
      // newest version rather than the one it started with.
      return new Map(rows.map((row) => [row.documentId, row.version]));
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
