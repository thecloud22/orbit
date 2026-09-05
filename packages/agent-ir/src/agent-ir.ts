import { agentIdSchema } from '@orbit/contracts';
import { z } from 'zod';

import {
  inputDeclarationSchema,
  identifierSchema,
  outputDeclarationSchema,
  variableDeclarationSchema,
} from './declarations';
import { permissionsSchema } from './permissions';
import { agentIrStepSchema, sopStepIdSchema } from './steps';

export const lifecycleStatusSchema = z.enum(['draft', 'published', 'archived']);
export type LifecycleStatus = z.infer<typeof lifecycleStatusSchema>;

/** Agent authority tiers (ADR-013). Phase 1 agents are `observe` only. */
export const trustTierSchema = z.enum([
  'observe',
  'recommend',
  'prepare',
  'execute_bounded',
  'high_impact',
  'autonomous_recovery',
]);
export type TrustTier = z.infer<typeof trustTierSchema>;

export const triggerTypeSchema = z.enum(['watchtower_manual']);
export type TriggerType = z.infer<typeof triggerTypeSchema>;

/**
 * Provenance back to the business procedure.
 *
 * `sourceSopStepIds` is the agent-local registry of SOP step IDs that its steps
 * may reference. This is a Phase 1 bridge: SOP Graph does not exist until
 * Phase 2, so the agent version declares its own source steps and the validator
 * checks every step against that declaration. Phase 2 replaces this with
 * validation against versioned SOP Graph nodes.
 */
export const agentIrSourceSchema = z.strictObject({
  sopId: z.string().min(1),
  sopVersion: z.string().min(1),
  sourceSopStepIds: z.array(sopStepIdSchema).min(1),
});
export type AgentIrSource = z.infer<typeof agentIrSourceSchema>;

export const agentVersionStringSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, 'must be a semantic version such as 0.1.0');

export const agentIrSchema = z.strictObject({
  schemaVersion: z.string().min(1),
  id: agentIdSchema,
  version: agentVersionStringSchema,
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  source: agentIrSourceSchema,
  lifecycle: z.strictObject({
    status: lifecycleStatusSchema,
    trustTier: trustTierSchema,
  }),
  trigger: z.strictObject({ type: triggerTypeSchema }),
  inputs: z.record(identifierSchema, inputDeclarationSchema),
  variables: z.record(identifierSchema, variableDeclarationSchema),
  outputs: z.record(identifierSchema, outputDeclarationSchema),
  permissions: permissionsSchema,
  steps: z.array(agentIrStepSchema).min(1),
});
export type AgentIr = z.infer<typeof agentIrSchema>;
