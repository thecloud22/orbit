/**
 * The Orbit persistence model.
 *
 *   Agent -> Agent Version -> Run -> Run Step -> Run Event
 *                                 -> Artifact -> Artifact Link
 *
 *   SOP Document -> SOP Graph Revision -> Clarification Answer
 *
 * The SOP side is deliberately unconnected to the Agent side: a reviewed SOP
 * Graph does not become an Agent Version in this phase, and there is no foreign
 * key that would suggest it might.
 *
 * Deletion follows that shape: cascading downward within a run, restricted
 * upward across the immutability boundary, so removing an agent or a version
 * that has runs fails rather than orphaning evidence.
 */
export * from './agent-ir-candidates';
export * from './agent-versions';
export * from './agents';
export * from './execution-bindings';
export * from './model-usage';
export * from './artifact-links';
export * from './artifacts';
export * from './run-events';
export * from './run-steps';
export * from './runs';
export * from './sop-clarification-answers';
export * from './sop-documents';
export * from './sop-graph-revisions';

/** Truncation order for the test reset: children before parents. */
export const ORBIT_TABLE_NAMES = [
  // Before revisions: a candidate references one with `restrict`, so truncating
  // revisions first would fail rather than cascade.
  'agent_ir_candidates',
  'execution_bindings',
  // Before documents: a usage row references one with `set null`, and the
  // reset truncates rather than nulls.
  'model_usage',
  'sop_clarification_answers',
  'sop_graph_revisions',
  'sop_documents',
  'artifact_links',
  'artifacts',
  'run_events',
  'run_steps',
  'runs',
  'agent_versions',
  'agents',
] as const;
