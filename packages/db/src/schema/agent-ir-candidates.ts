import type { AgentIr } from '@orbit/agent-ir';
import type { AgentIrCandidateId, SopDocumentId, SopRevisionId } from '@orbit/contracts';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { createdAt, inValues, isSha256, opaqueId, timestamptz, updatedAt } from './columns';
import { sopDocuments } from './sop-documents';
import { sopGraphRevisions } from './sop-graph-revisions';

/**
 * The lifecycle of one candidate Agent IR.
 *
 * `compiled` is not `draft`: a candidate is not authored, it is derived. Nobody
 * writes one and nobody edits one — recompiling produces a new candidate that
 * supersedes its predecessor, exactly as a re-recording supersedes a binding
 * (ADR-018) and an edit supersedes a revision (ADR-016).
 *
 * The separate technical approval the requirements call for is the transition
 * `compiled -> approved`, and it is the only route to a publishable candidate.
 */
export const CANDIDATE_STATES = ['compiled', 'approved', 'rejected', 'superseded'] as const;
export type CandidateState = (typeof CANDIDATE_STATES)[number];

/**
 * Which states may move to which.
 *
 * A candidate is never edited, so there is no route back to `compiled`:
 * recompiling produces a new candidate and supersedes this one. Approval and
 * rejection are terminal but for supersession, so what a person approved keeps
 * meaning what it meant.
 */
export const CANDIDATE_TRANSITIONS: Readonly<Record<CandidateState, readonly CandidateState[]>> = {
  compiled: ['approved', 'rejected', 'superseded'],
  approved: ['superseded'],
  rejected: ['superseded'],
  superseded: [],
};

/** The states from which `target` may be reached, for use in a `WHERE` clause. */
export function candidateStatesAllowedToReach(target: CandidateState): readonly CandidateState[] {
  return CANDIDATE_STATES.filter((state) => CANDIDATE_TRANSITIONS[state].includes(target));
}

/**
 * Whether a candidate could be checked against a real page before approval.
 *
 * `cannot_validate` is a distinct state from `failed` on purpose. A workflow
 * needing a secret Orbit cannot supply was never *tried* — no browser was
 * opened — and recording that as a failure would suggest something was
 * attempted and did not work, which would be untrue in the one place where
 * being precise matters most: the record of what a person approved.
 */
export const CANDIDATE_SANDBOX_STATES = ['not_assessed', 'ready', 'cannot_validate'] as const;
export type CandidateSandboxState = (typeof CANDIDATE_SANDBOX_STATES)[number];

/**
 * Candidate Agent IR compiled from a reviewed graph and its approved mappings.
 *
 * The whole compiled document is stored as JSONB beside its checksum, the same
 * posture `agent_versions.ir_sha256` and `sop_graph_revisions.graph_sha256`
 * already take: an artifact whose meaning can drift silently cannot serve as
 * the record of what somebody approved.
 *
 * `compiled_from` records exactly which bindings went in, because approving a
 * candidate is approving a specific set of mappings and a later publication has
 * to be able to name them.
 */
export const agentIrCandidates = pgTable(
  'agent_ir_candidates',
  {
    id: opaqueId<AgentIrCandidateId>('id').primaryKey(),
    documentId: opaqueId<SopDocumentId>('document_id')
      .notNull()
      // Cascade: a candidate is derived from a document, not independent of it.
      .references(() => sopDocuments.id, { onDelete: 'cascade' }),
    /**
     * The revision compiled.
     *
     * `restrict` rather than `set null`: a candidate that cannot say which
     * revision it came from is not evidence of anything, and a revision is
     * immutable so there is no reason it should ever go away beneath one.
     */
    revisionId: opaqueId<SopRevisionId>('revision_id')
      .notNull()
      .references(() => sopGraphRevisions.id, { onDelete: 'restrict' }),
    candidateNumber: integer('candidate_number').notNull(),
    agentIr: jsonb('agent_ir').$type<AgentIr>().notNull(),
    agentIrSha256: text('agent_ir_sha256').notNull(),
    /**
     * Historical only, and empty for anything compiled since ADR-030.
     *
     * A business outcome used to be one of two inherited names, so a person had
     * to say which of them each of their workflow's own outcomes meant, and that
     * answer was recorded here. Outcomes are now the workflow's own declared
     * names and the mapping is the identity, so there is nothing left to record.
     * The column is kept rather than dropped because the rows written before the
     * change hold a real answer a person gave, and dropping it would destroy that.
     */
    outcomeMapping: jsonb('outcome_mapping').$type<Record<string, string>>().notNull(),
    /** The exact binding ids that went in, so approval names a fixed set. */
    compiledFromBindingIds: jsonb('compiled_from_binding_ids').$type<readonly string[]>().notNull(),
    /**
     * Inputs the workflow needs that Orbit cannot supply.
     *
     * Kept here rather than derived from the IR because Agent IR has no secret
     * type — a secret input compiles to an ordinary string declaration, so
     * secret-ness is not recoverable from the compiled document.
     */
    secretInputIds: jsonb('secret_input_ids').$type<readonly string[]>().notNull(),
    sandboxState: text('sandbox_state')
      .$type<CandidateSandboxState>()
      .notNull()
      .default('not_assessed'),
    /** Why it could not be validated. Never page content and never a secret. */
    sandboxNote: text('sandbox_note'),
    state: text('state').$type<CandidateState>().notNull().default('compiled'),
    supersededByCandidateId: opaqueId<AgentIrCandidateId>('superseded_by_candidate_id').references(
      (): AnyPgColumn => agentIrCandidates.id,
      { onDelete: 'set null' },
    ),
    reviewedAt: timestamptz('reviewed_at'),
    /** Why a reviewer approved or rejected. Never a secret or page content. */
    reviewNote: text('review_note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('agent_ir_candidates_document_number_unique').on(
      table.documentId,
      table.candidateNumber,
    ),
    index('agent_ir_candidates_document_id_idx').on(table.documentId),
    index('agent_ir_candidates_state_idx').on(table.state),
    check('agent_ir_candidates_state_check', inValues(table.state, CANDIDATE_STATES)),
    check(
      'agent_ir_candidates_sandbox_state_check',
      inValues(table.sandboxState, CANDIDATE_SANDBOX_STATES),
    ),
    check('agent_ir_candidates_sha256_check', isSha256(table.agentIrSha256)),
  ],
);

export type AgentIrCandidateRow = typeof agentIrCandidates.$inferSelect;
export type NewAgentIrCandidateRow = typeof agentIrCandidates.$inferInsert;
