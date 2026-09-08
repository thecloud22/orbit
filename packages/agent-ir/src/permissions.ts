import { z } from 'zod';

/**
 * Browser capabilities an agent version is permitted to use.
 *
 * These declarations are enforced, not documentation: the semantic validator
 * rejects an agent that uses a step or captures evidence it has not been
 * granted, and the runtime re-checks the domain allowlist before navigating.
 */
export const browserActionSchema = z.enum([
  'navigate',
  'fill',
  'click',
  'assert',
  'expect_one_of',
  'extract',
  'screenshot',
  'dom_snapshot',
]);
export type BrowserAction = z.infer<typeof browserActionSchema>;

export const browserPermissionsSchema = z.strictObject({
  allowedDomains: z.array(z.string().min(1)).min(1),
  allowedActions: z.array(browserActionSchema).min(1),
});
export type BrowserPermissions = z.infer<typeof browserPermissionsSchema>;

/**
 * Whether this agent may call a model at run time, and how often.
 *
 * Its own section rather than a browser action, because a model call is a
 * different capability from anything a browser does: it leaves the machine, it
 * costs money, and it is the only place in an execution where the answer is not
 * determined by the page. Smuggling it in under a browser grant would mean an
 * agent granted `click` had quietly been granted judgement too.
 *
 * Absent means not permitted. An agent that contains a `model.decide` step and
 * declares no `permissions.model` is refused by the validator, so the capability
 * is opt-in per published version and visible in review.
 */
export const modelPermissionsSchema = z.strictObject({
  allowed: z.boolean(),
  /**
   * A ceiling on judged decisions in one run, independent of the token budget.
   *
   * Two limits rather than one because they catch different faults: a token cap
   * catches an expensive workflow, and this catches a workflow that calls a
   * model far more often than its author believed it would.
   */
  maxCallsPerRun: z.number().int().positive(),
});
export type ModelPermissions = z.infer<typeof modelPermissionsSchema>;

/**
 * Whether Orbit may *propose* a repair when this agent hits UI drift.
 *
 * Its own section, for the reason `permissions.model` has one: proposing a
 * repair is a different capability from anything a browser action grants. An
 * agent granted `click` has been granted the right to press a button somebody
 * approved — not the right to have opinions about what should replace it.
 *
 * Absent means not permitted, and an agent without this grant produces no
 * proposals at all: the runtime gathers no observation and the proposer is
 * never reached. Under ADR-013 this is the step from Tier 0 `observe` to
 * Tier 1 `recommend`, and it stops there. There is no `apply` to grant,
 * because there is no code path that applies a proposal (ADR-033).
 */
export const recoveryPermissionsSchema = z.strictObject({
  allowed: z.boolean(),
});
export type RecoveryPermissions = z.infer<typeof recoveryPermissionsSchema>;

export const permissionsSchema = z.strictObject({
  browser: browserPermissionsSchema,
  model: modelPermissionsSchema.optional(),
  recovery: recoveryPermissionsSchema.optional(),
});
export type Permissions = z.infer<typeof permissionsSchema>;

/**
 * Maps each browser-prefixed step type to the permission it consumes.
 *
 * `complete` and `fail` are absent by design: they are workflow terminators
 * that touch no browser capability, so they require no browser grant.
 */
export const STEP_TYPE_TO_BROWSER_ACTION = {
  'browser.navigate': 'navigate',
  'browser.fill': 'fill',
  'browser.click': 'click',
  'browser.assert': 'assert',
  'browser.expect_one_of': 'expect_one_of',
  'browser.extract': 'extract',
} as const satisfies Record<string, BrowserAction>;

export type PermissionedStepType = keyof typeof STEP_TYPE_TO_BROWSER_ACTION;

/** Evidence capture consumes its own grants, separate from the step action. */
export const EVIDENCE_TO_BROWSER_ACTION = {
  captureScreenshot: 'screenshot',
  captureDomSnapshot: 'dom_snapshot',
} as const satisfies Record<string, BrowserAction>;

/** Phase 1 permits only these URL protocols; file:, data:, and javascript: are rejected. */
export const ALLOWED_URL_PROTOCOLS = ['http:', 'https:'] as const;
