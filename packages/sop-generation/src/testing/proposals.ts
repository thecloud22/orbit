import { escalationReviewGraph } from '@orbit/sop-graph/testing';

/**
 * Proposals a fake provider can return.
 *
 * They are built from the sub-phase 2.1 worked example rather than from a toy
 * graph, so what the pipeline is tested against is the realistic target shape:
 * a login, a cardinality decision, nested decisions, a derived value, a
 * conditional sub-path, an optional extraction beside required ones, three
 * manual-review paths, and an outcome returning a value only some runs produce.
 */

/** A model's reply, which never contains `schemaVersion` — code adds that. */
export function validSopGraphProposal(): Record<string, unknown> {
  const proposal: Record<string, unknown> = { ...escalationReviewGraph() };
  delete proposal['schemaVersion'];
  return proposal;
}

/**
 * Invalid on purpose: the entry step names a step that does not exist.
 *
 * A semantic failure rather than a schema one, so it proves the pipeline runs
 * the whole graph validator and not merely `sopGraphSchema`.
 */
export function invalidSopGraphProposal(): Record<string, unknown> {
  return { ...validSopGraphProposal(), entryStepId: 'no_such_step' };
}
