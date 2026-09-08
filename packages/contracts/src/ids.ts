import { z } from 'zod';

/**
 * Opaque identifiers for Orbit domain entities.
 *
 * Public and persisted IDs are opaque strings with a documented prefix so a
 * value is self-describing in logs, events, and evidence. Each schema is
 * branded, so an AgentVersionId cannot be passed where a RunId is expected
 * even though both are strings at runtime.
 */

const ID_SUFFIX = '[A-Za-z0-9][A-Za-z0-9_-]*';

function idPattern(prefix: string): RegExp {
  return new RegExp(`^${prefix}_${ID_SUFFIX}$`);
}

export const agentIdSchema = z
  .string()
  .regex(idPattern('agent'), 'must be an opaque id prefixed with "agent_"')
  .brand<'AgentId'>();
export type AgentId = z.infer<typeof agentIdSchema>;

export const agentVersionIdSchema = z
  .string()
  .regex(idPattern('agentv'), 'must be an opaque id prefixed with "agentv_"')
  .brand<'AgentVersionId'>();
export type AgentVersionId = z.infer<typeof agentVersionIdSchema>;

export const runIdSchema = z
  .string()
  .regex(idPattern('run'), 'must be an opaque id prefixed with "run_"')
  .brand<'RunId'>();
export type RunId = z.infer<typeof runIdSchema>;

export const runStepIdSchema = z
  .string()
  .regex(idPattern('rstep'), 'must be an opaque id prefixed with "rstep_"')
  .brand<'RunStepId'>();
export type RunStepId = z.infer<typeof runStepIdSchema>;

export const eventIdSchema = z
  .string()
  .regex(idPattern('evt'), 'must be an opaque id prefixed with "evt_"')
  .brand<'EventId'>();
export type EventId = z.infer<typeof eventIdSchema>;

export const artifactIdSchema = z
  .string()
  .regex(idPattern('art'), 'must be an opaque id prefixed with "art_"')
  .brand<'ArtifactId'>();
export type ArtifactId = z.infer<typeof artifactIdSchema>;

export const requestIdSchema = z
  .string()
  .regex(idPattern('req'), 'must be an opaque id prefixed with "req_"')
  .brand<'RequestId'>();
export type RequestId = z.infer<typeof requestIdSchema>;

/**
 * SOP Graph identifiers (Phase 2).
 *
 * An SOP document is the authoring container, a revision is one immutable
 * version of its graph, and an answer belongs to one clarification question on
 * one revision. They are ordinary opaque Orbit ids: the graph document itself
 * is owned by @orbit/sop-graph, but identifiers live here with every other
 * public id, the same split `agent_versions` already uses.
 */
export const sopDocumentIdSchema = z
  .string()
  .regex(idPattern('sopdoc'), 'must be an opaque id prefixed with "sopdoc_"')
  .brand<'SopDocumentId'>();
export type SopDocumentId = z.infer<typeof sopDocumentIdSchema>;

export const sopRevisionIdSchema = z
  .string()
  .regex(idPattern('soprev'), 'must be an opaque id prefixed with "soprev_"')
  .brand<'SopRevisionId'>();
export type SopRevisionId = z.infer<typeof sopRevisionIdSchema>;

export const sopAnswerIdSchema = z
  .string()
  .regex(idPattern('sopans'), 'must be an opaque id prefixed with "sopans_"')
  .brand<'SopAnswerId'>();
export type SopAnswerId = z.infer<typeof sopAnswerIdSchema>;

/**
 * Execution Binding identifier (Phase 2.4).
 *
 * A binding records which element on a real page a SOP step acts on. It is a
 * separate entity from the graph it binds to — a graph is business intent, a
 * binding is how that intent reaches a browser (ADR-002) — so it carries its
 * own id rather than being addressed through the revision.
 */
export const executionBindingIdSchema = z
  .string()
  .regex(idPattern('execbind'), 'must be an opaque id prefixed with "execbind_"')
  .brand<'ExecutionBindingId'>();
export type ExecutionBindingId = z.infer<typeof executionBindingIdSchema>;

/**
 * Model usage identifiers (Phase 2.8).
 *
 * A `modelusage_` id names one provider *call*, and a `modelreq_` id names the
 * request that made it — a single Generate, which may involve an initial call
 * and one repair. They are separate ids because the per-run budget is a sum
 * over the request while the ledger is a row per call: one id could not carry
 * both meanings without the ledger losing the ability to say what a single
 * request actually cost.
 */
export const modelUsageIdSchema = z
  .string()
  .regex(idPattern('modelusage'), 'must be an opaque id prefixed with "modelusage_"')
  .brand<'ModelUsageId'>();
export type ModelUsageId = z.infer<typeof modelUsageIdSchema>;

export const modelRequestIdSchema = z
  .string()
  .regex(idPattern('modelreq'), 'must be an opaque id prefixed with "modelreq_"')
  .brand<'ModelRequestId'>();
export type ModelRequestId = z.infer<typeof modelRequestIdSchema>;

/**
 * Candidate Agent IR identifier (Phase 2.5).
 *
 * A candidate is a proposal that a reviewed graph and its approved mappings
 * could become a runnable agent. It is a separate entity from both — it can be
 * rejected while they stand, and it is superseded by recompilation — so it
 * carries its own id rather than being addressed through either.
 */
export const agentIrCandidateIdSchema = z
  .string()
  .regex(idPattern('aircand'), 'must be an opaque id prefixed with "aircand_"')
  .brand<'AgentIrCandidateId'>();
export type AgentIrCandidateId = z.infer<typeof agentIrCandidateIdSchema>;

/**
 * Recovery proposal identifier (Phase 2 Task 12).
 *
 * A proposal is Orbit's suggestion that a step's element has moved and this
 * other element is the one that replaced it. It is not a binding: it names no
 * live mapping, supersedes nothing, and does nothing until a person accepts it
 * (ADR-033). Its own id, because it outlives the run that motivated it and can
 * be dismissed while the binding it talks about stands unchanged.
 */
export const bindingRecoveryProposalIdSchema = z
  .string()
  .regex(idPattern('recprop'), 'must be an opaque id prefixed with "recprop_"')
  .brand<'BindingRecoveryProposalId'>();
export type BindingRecoveryProposalId = z.infer<typeof bindingRecoveryProposalIdSchema>;

export const artifactLinkIdSchema = z
  .string()
  .regex(idPattern('artl'), 'must be an opaque id prefixed with "artl_"')
  .brand<'ArtifactLinkId'>();
export type ArtifactLinkId = z.infer<typeof artifactLinkIdSchema>;
