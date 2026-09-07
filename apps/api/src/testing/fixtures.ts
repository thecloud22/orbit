import { agentIdSchema, agentVersionIdSchema, type AgentVersionId } from '@orbit/contracts';
import type { AgentVersionRecord } from '@orbit/db';
import { loadFixtureAgentIr } from '@orbit/runtime/testing';

/** The seeded Agent Version, as a record, without touching a database. */
export const SEEDED_AGENT_VERSION_ID: AgentVersionId = agentVersionIdSchema.parse(
  'agentv_find_service_request_0_1_0',
);

export function agentVersionRecord(
  overrides: Partial<AgentVersionRecord> = {},
): AgentVersionRecord {
  const agentIr = loadFixtureAgentIr();

  return {
    id: SEEDED_AGENT_VERSION_ID,
    agentId: agentIdSchema.parse('agent_find_service_request'),
    version: agentIr.version,
    name: agentIr.name,
    description: agentIr.description ?? null,
    schemaVersion: agentIr.schemaVersion,
    lifecycleStatus: 'published',
    trustTier: 'observe',
    sourceSopId: agentIr.source.sopId,
    sourceSopVersion: agentIr.source.sopVersion,
    agentIr,
    // The seeded agent came from a fixture, not a candidate. Null here is the
    // same thing the database holds for it.
    publishedFromCandidateId: null,
    irSha256: 'a'.repeat(64),
    createdAt: new Date('2026-09-05T16:00:00.000Z'),
    publishedAt: new Date('2026-09-05T16:00:00.000Z'),
    ...overrides,
  };
}
