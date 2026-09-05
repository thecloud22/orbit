import { z } from 'zod';

import { artifactIdSchema, eventIdSchema, runIdSchema, runStepIdSchema } from './ids';

/** Artifact bytes live outside PostgreSQL; only this metadata is persisted there. */
export const artifactKindSchema = z.enum([
  'browser_screenshot',
  'dom_snapshot',
  'browser_trace',
  'extracted_json',
  'error_context',
]);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

export const artifactMetadataSchema = z.strictObject({
  id: artifactIdSchema,
  runId: runIdSchema,
  runStepId: runStepIdSchema.optional(),
  kind: artifactKindSchema,
  contentType: z.string().min(1),
  /** Opaque key in the artifact store; never a caller-supplied filesystem path. */
  storageKey: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/, 'must be a lowercase hex sha256 digest'),
  createdAt: z.iso.datetime(),
});
export type ArtifactMetadata = z.infer<typeof artifactMetadataSchema>;

/**
 * An artifact may be linked to several kinds of entity. Phase 1 requires links
 * to a run, a run step, and the relevant event; later phases add SOP nodes,
 * agent versions, and approval requests as further members of this union.
 */
export const artifactLinkSchema = z.discriminatedUnion('targetType', [
  z.strictObject({
    artifactId: artifactIdSchema,
    targetType: z.literal('run'),
    targetId: runIdSchema,
  }),
  z.strictObject({
    artifactId: artifactIdSchema,
    targetType: z.literal('run_step'),
    targetId: runStepIdSchema,
  }),
  z.strictObject({
    artifactId: artifactIdSchema,
    targetType: z.literal('run_event'),
    targetId: eventIdSchema,
  }),
]);
export type ArtifactLink = z.infer<typeof artifactLinkSchema>;
