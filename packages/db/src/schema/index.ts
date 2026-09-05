/**
 * The Orbit persistence model.
 *
 *   Agent -> Agent Version -> Run -> Run Step -> Run Event
 *                                 -> Artifact -> Artifact Link
 *
 * Deletion follows that shape: cascading downward within a run, restricted
 * upward across the immutability boundary, so removing an agent or a version
 * that has runs fails rather than orphaning evidence.
 */
export * from './agent-versions';
export * from './agents';
export * from './artifact-links';
export * from './artifacts';
export * from './run-events';
export * from './run-steps';
export * from './runs';

/** Truncation order for the test reset: children before parents. */
export const ORBIT_TABLE_NAMES = [
  'artifact_links',
  'artifacts',
  'run_events',
  'run_steps',
  'runs',
  'agent_versions',
  'agents',
] as const;
