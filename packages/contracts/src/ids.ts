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
