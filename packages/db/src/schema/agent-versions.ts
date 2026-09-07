import type { AgentId, AgentIrCandidateId, AgentVersionId } from '@orbit/contracts';
import { check, index, jsonb, pgTable, text, unique } from 'drizzle-orm/pg-core';

import { agentIrCandidates } from './agent-ir-candidates';
import { agents } from './agents';
import { createdAt, inValues, isSha256, opaqueId, timestamptz } from './columns';

export const LIFECYCLE_STATUSES = ['draft', 'published', 'archived'] as const;

export const TRUST_TIERS = [
  'observe',
  'recommend',
  'prepare',
  'execute_bounded',
  'high_impact',
  'autonomous_recovery',
] as const;

/**
 * An immutable published workflow definition (ADR-005).
 *
 * `agentIr` holds the whole validated Agent IR document as JSONB rather than a
 * decomposed set of step/locator/assertion tables. The IR is a versioned
 * contract owned by @orbit/agent-ir and is always read back as one unit;
 * shredding it into relational tables would fork the contract and make every
 * IR change a migration. The columns beside it are denormalized copies used for
 * listing and filtering without opening the document.
 *
 * `irSha256` is a checksum over the canonical JSON of the stored document. It
 * makes re-seeding idempotent and lets any reader prove the IR it executed is
 * the IR that was validated.
 *
 * Immutability is enforced by the repository API, which exposes no update path,
 * and by tests. Database-level enforcement is deferred (see ADR-014).
 */
export const agentVersions = pgTable(
  'agent_versions',
  {
    id: opaqueId<AgentVersionId>('id').primaryKey(),
    agentId: opaqueId<AgentId>('agent_id')
      .notNull()
      // Restrict, not cascade: deleting an agent must never silently destroy
      // the definition its historical runs were executed against.
      .references(() => agents.id, { onDelete: 'restrict' }),
    version: text('version').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    schemaVersion: text('schema_version').notNull(),
    lifecycleStatus: text('lifecycle_status')
      .$type<(typeof LIFECYCLE_STATUSES)[number]>()
      .notNull(),
    trustTier: text('trust_tier').$type<(typeof TRUST_TIERS)[number]>().notNull(),
    sourceSopId: text('source_sop_id').notNull(),
    sourceSopVersion: text('source_sop_version').notNull(),
    agentIr: jsonb('agent_ir').$type<Record<string, unknown>>().notNull(),
    irSha256: text('ir_sha256').notNull(),
    /**
     * The approved candidate this version was published from (sub-phase 2.6).
     *
     * Nullable, and permanently so: the seeded Phase 1 agent was published from
     * a fixture rather than a candidate, and every version predating 2.5 has no
     * candidate to point at. A column that forced one would have meant
     * rewriting rows whose immutability is the whole point (ADR-014).
     *
     * `set null` rather than `cascade`: losing the candidate must never delete
     * the version, because the version is what historical runs executed. The
     * provenance link is worth less than the artifact it annotates.
     */
    publishedFromCandidateId: opaqueId<AgentIrCandidateId>(
      'published_from_candidate_id',
    ).references(() => agentIrCandidates.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    publishedAt: timestamptz('published_at'),
  },
  (table) => [
    unique('agent_versions_agent_id_version_unique').on(table.agentId, table.version),
    index('agent_versions_agent_id_idx').on(table.agentId),
    index('agent_versions_lifecycle_status_idx').on(table.lifecycleStatus),
    check(
      'agent_versions_lifecycle_status_check',
      inValues(table.lifecycleStatus, LIFECYCLE_STATUSES),
    ),
    check('agent_versions_trust_tier_check', inValues(table.trustTier, TRUST_TIERS)),
    check('agent_versions_ir_sha256_check', isSha256(table.irSha256)),
  ],
);

export type AgentVersionRow = typeof agentVersions.$inferSelect;
export type NewAgentVersionRow = typeof agentVersions.$inferInsert;
