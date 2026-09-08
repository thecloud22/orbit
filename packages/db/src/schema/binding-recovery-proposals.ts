import type {
  AgentVersionId,
  BindingRecoveryProposalId,
  ExecutionBindingId,
  RunId,
  SopDocumentId,
} from '@orbit/contracts';
import type { ExecutionBinding } from '@orbit/execution-mapping';
import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { createdAt, inValues, isSha256, opaqueId, timestamptz, updatedAt } from './columns';
import { agentVersions } from './agent-versions';
import { executionBindings } from './execution-bindings';
import { runs } from './runs';
import { sopDocuments } from './sop-documents';

/**
 * A recovery proposal, and why it is not a binding (ADR-033).
 *
 * When a run stops on drift, Orbit can sometimes say *deterministically* what
 * happened: the approved test id finds nothing, but the same binding's
 * `role_and_name` fallback still resolves to an element whose fingerprint is
 * what a person approved. That is "the test id changed, the button did not",
 * and it is worth telling someone.
 *
 * It is worth telling someone, and nothing more. This table is where that
 * sentence is kept until a person reads it. It is deliberately **not** a row in
 * `execution_bindings`, for two reasons that are both about not breaking
 * promises the rest of the system already makes:
 *
 *   - `listCurrent` returns the newest non-superseded binding per step, and
 *     compile and publish then require that binding to be `approved`. A draft
 *     row here would shadow the approved binding it hopes to replace, and a
 *     pending proposal would silently block publishing a document that has
 *     nothing wrong with it.
 *   - A proposal supersedes nothing. `executionBindings.create` supersedes its
 *     parent in the same transaction, by design — that is what keeps "one live
 *     binding per step" true. A proposal must leave the approved mapping
 *     completely untouched while it waits, including if it waits forever.
 *
 * Accepting one creates a real binding through the ordinary path — the same
 * `createBinding` a person recording a step goes through, ending `approved` —
 * so there is exactly one way a binding is ever made, and recovery is not a
 * second one.
 */
export const RECOVERY_PROPOSAL_STATES = ['proposed', 'accepted', 'dismissed'] as const;

export type RecoveryProposalState = (typeof RECOVERY_PROPOSAL_STATES)[number];

export const bindingRecoveryProposals = pgTable(
  'binding_recovery_proposals',
  {
    id: opaqueId<BindingRecoveryProposalId>('id').primaryKey(),
    /** A proposal is about a document's step, not about the run that found it. */
    documentId: opaqueId<SopDocumentId>('document_id')
      .notNull()
      .references(() => sopDocuments.id, { onDelete: 'cascade' }),
    stepId: text('step_id').notNull(),
    /**
     * The approved binding this would replace. Never modified by this row.
     *
     * Cascade: a proposal about a binding that no longer exists is about
     * nothing. It says what should replace *that* mapping, and cannot be
     * reinterpreted against a different one.
     */
    proposedForBindingId: opaqueId<ExecutionBindingId>('proposed_for_binding_id')
      .notNull()
      .references(() => executionBindings.id, { onDelete: 'cascade' }),
    /**
     * The run that motivated it, and the version that run executed.
     *
     * `set null` on both: the proposal is a fact about the document and must
     * outlive its provenance rather than disappear with it.
     */
    observedInRunId: opaqueId<RunId>('observed_in_run_id').references(() => runs.id, {
      onDelete: 'set null',
    }),
    observedInAgentVersionId: opaqueId<AgentVersionId>('observed_in_agent_version_id').references(
      () => agentVersions.id,
      { onDelete: 'set null' },
    ),
    state: text('state').$type<RecoveryProposalState>().notNull().default('proposed'),
    /**
     * The binding that would be created if a person accepts this.
     *
     * Stored whole rather than as a diff, because a diff would have to be
     * reapplied against whatever the binding says at accept time — and what a
     * reviewer approves has to be exactly what they were shown.
     */
    proposedBinding: jsonb('proposed_binding').$type<ExecutionBinding>().notNull(),
    proposedBindingSha256: text('proposed_binding_sha256').notNull(),
    /**
     * Why Orbit believes this is the same element: the fingerprint as approved,
     * the fingerprint now, which locator failed and which one answered.
     *
     * Element labels and roles only. Never page content, and never a value the
     * workflow read.
     */
    diagnosis: jsonb('diagnosis').$type<Record<string, unknown>>().notNull(),
    /**
     * True when no model was involved in producing this, which today is always.
     *
     * A column rather than an assumption, because the moment ranking is ever
     * switched on, a reader looking at an old proposal must be able to tell
     * which kind they are looking at without knowing when the flag flipped.
     */
    deterministic: boolean('deterministic').notNull().default(true),
    /** Set when accepted: the binding this actually produced. */
    resultingBindingId: opaqueId<ExecutionBindingId>('resulting_binding_id').references(
      () => executionBindings.id,
      { onDelete: 'set null' },
    ),
    resolutionNote: text('resolution_note'),
    resolvedAt: timestamptz('resolved_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    /**
     * One open proposal per step.
     *
     * A drifted agent run on a schedule would otherwise write an identical
     * proposal every run, and a reviewer would open Studio to a hundred copies
     * of one sentence. The second and later observations are recorded as
     * `recovery.declined` with reason `already_proposed`, which is honest: the
     * proposal exists, it is just not a new one.
     */
    uniqueIndex('binding_recovery_proposals_open_per_step_unique')
      .on(table.documentId, table.stepId)
      .where(sql`state = 'proposed'`),
    index('binding_recovery_proposals_document_id_idx').on(table.documentId),
    index('binding_recovery_proposals_state_idx').on(table.state),
    check(
      'binding_recovery_proposals_state_check',
      inValues(table.state, RECOVERY_PROPOSAL_STATES),
    ),
    check('binding_recovery_proposals_binding_sha256_check', isSha256(table.proposedBindingSha256)),
    // A resolved proposal always records when it was resolved.
    check(
      'binding_recovery_proposals_resolved_at_check',
      sql`${table.state} = 'proposed' OR ${table.resolvedAt} IS NOT NULL`,
    ),
    // Only an accepted proposal has produced a binding.
    check(
      'binding_recovery_proposals_resulting_binding_check',
      sql`${table.state} = 'accepted' OR ${table.resultingBindingId} IS NULL`,
    ),
  ],
);

export type BindingRecoveryProposalRow = typeof bindingRecoveryProposals.$inferSelect;
export type NewBindingRecoveryProposalRow = typeof bindingRecoveryProposals.$inferInsert;
