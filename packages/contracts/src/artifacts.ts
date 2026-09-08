import { z } from 'zod';

import {
  artifactIdSchema,
  artifactLinkIdSchema,
  eventIdSchema,
  runIdSchema,
  runStepIdSchema,
} from './ids';

/** Artifact bytes live outside PostgreSQL; only this metadata is persisted there. */
export const artifactKindSchema = z.enum([
  'browser_screenshot',
  'dom_snapshot',
  'browser_trace',
  'extracted_json',
  'error_context',
  /** The exact text a judged decision was shown. Redacted before it is stored. */
  'decision_input',
  /**
   * A terminal screen, as text.
   *
   * Better evidence than a screenshot rather than a poorer substitute for one:
   * diffable, greppable, and small. Non-display fields are masked before it is
   * stored, from the field attribute rather than from a guess (ADR-037).
   */
  'terminal_screen',
  /**
   * One run's API request/response exchanges.
   *
   * The API surface's answer to the screenshot. Without it the surface has no
   * evidence and Watchtower's expected-versus-observed view has nothing to show
   * for a step (ADR-004). Sensitive headers are redacted by name.
   */
  'api_exchange',
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
 * The evidential role an artifact plays for its target.
 *
 * Role is not the same as artifact kind: a `browser_screenshot` is the artifact
 * kind, while `screenshot_after_action` and `error_context` are two different
 * reasons that screenshot is attached. Watchtower renders by role.
 */
export const artifactLinkRoleSchema = z.enum([
  'screenshot_after_action',
  'dom_snapshot',
  'browser_trace',
  'error_context',
  'extracted_json',
  'decision_input',
  'screen_after_action',
  'api_exchange',
]);
export type ArtifactLinkRole = z.infer<typeof artifactLinkRoleSchema>;

/**
 * An artifact may be linked to several kinds of entity. Phase 1 requires links
 * to a run, a run step, and the relevant event; later phases add SOP nodes,
 * agent versions, and approval requests as further members of this union.
 */
const artifactLinkBase = {
  id: artifactLinkIdSchema,
  artifactId: artifactIdSchema,
  role: artifactLinkRoleSchema,
};

export const artifactLinkSchema = z.discriminatedUnion('targetType', [
  z.strictObject({
    ...artifactLinkBase,
    targetType: z.literal('run'),
    targetId: runIdSchema,
  }),
  z.strictObject({
    ...artifactLinkBase,
    targetType: z.literal('run_step'),
    targetId: runStepIdSchema,
  }),
  z.strictObject({
    ...artifactLinkBase,
    targetType: z.literal('run_event'),
    targetId: eventIdSchema,
  }),
]);
export type ArtifactLink = z.infer<typeof artifactLinkSchema>;
