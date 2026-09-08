import { z } from 'zod';

/**
 * The execution surfaces Orbit can drive.
 *
 * A surface is the unit of capability: each one brings its own permission
 * section, its own closed addressing vocabulary, and its own evidence set, and
 * a surface that cannot supply all three is not added (ADR-037).
 *
 * One member today. `terminal` and `api` join it when the sub-phases that give
 * them an addressing vocabulary and an evidence set land — adding a surface and
 * its optional permission section is additive, and an Agent Version published
 * before it simply does not declare it. What is *not* additive is changing the
 * shape of a section that already exists, because `permissions` is embedded in
 * published, immutable Agent Versions (ADR-005, ADR-014).
 */
export const EXECUTION_SURFACES = ['browser', 'terminal'] as const;
export type ExecutionSurface = (typeof EXECUTION_SURFACES)[number];

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
 * Terminal capabilities an agent version is permitted to use.
 *
 * `allowedHosts` is the terminal counterpart of `allowedDomains` and exists for
 * the same reason (ADR-022): containment is per agent, derived from what a
 * recording actually reached, checked at publish and again before the socket is
 * opened. A mainframe LPAR is a far more consequential thing to reach by
 * accident than a web page, so the rule is exact-match here too -- a
 * neighbouring host is a different system.
 */
export const terminalActionSchema = z.enum(['connect', 'type', 'press', 'read', 'expect_screen']);
export type TerminalAction = z.infer<typeof terminalActionSchema>;

export const terminalPermissionsSchema = z.strictObject({
  allowedHosts: z.array(z.string().min(1)).min(1),
  allowedActions: z.array(terminalActionSchema).min(1),
});
export type TerminalPermissions = z.infer<typeof terminalPermissionsSchema>;

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

/**
 * What an agent version is allowed to do, by surface.
 *
 * `browser` is optional rather than required, which is the change that lets an
 * Agent Version exist that never opens a browser. Absence means the surface is
 * not permitted — the rule `model` and `recovery` already follow — so an agent
 * that contains a browser step and declares no browser section is refused by
 * the validator rather than defaulting to anything.
 *
 * A required section nobody means is a section that stops being read, and it
 * would also make "does this agent touch a browser?" unanswerable from the
 * contract.
 */
/**
 * The credential references this agent version may resolve at run time.
 *
 * A closed list, for the reason `allowedDomains` is one: the grant is what the
 * version was published with, so a step cannot reach a credential nobody
 * reviewed. Absent means no credential may be resolved at all.
 *
 * Deliberately names references, never values. Orbit resolves a name from
 * deployment configuration at the moment of use; nothing here, in the compiled
 * document, or in the run row ever holds the secret itself.
 */
export const credentialPermissionsSchema = z.strictObject({
  allowedRefs: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/)).min(1),
});
export type CredentialPermissions = z.infer<typeof credentialPermissionsSchema>;

export const permissionsSchema = z.strictObject({
  browser: browserPermissionsSchema.optional(),
  terminal: terminalPermissionsSchema.optional(),
  model: modelPermissionsSchema.optional(),
  recovery: recoveryPermissionsSchema.optional(),
  credentials: credentialPermissionsSchema.optional(),
});
export type Permissions = z.infer<typeof permissionsSchema>;

/**
 * The permission one step type consumes: which surface, and which action on it.
 *
 * A union rather than `{ surface: string; action: string }` so each surface
 * keeps its own action vocabulary and a typo cannot typecheck. A second member
 * joins it per surface.
 */
export type StepPermission =
  | { readonly surface: 'browser'; readonly action: BrowserAction }
  | { readonly surface: 'terminal'; readonly action: TerminalAction };

/**
 * Maps each step type to the surface and action it consumes.
 *
 * `complete` and `fail` are absent by design: they are workflow terminators
 * that touch no surface, so they require no grant. `model.decide` is absent
 * too — it consumes `permissions.model`, which is a capability rather than a
 * surface, and is checked separately.
 *
 * `satisfies` rather than a plain annotation so the table keeps its literal
 * types while still being checked: a step type mapped to an action its surface
 * does not define fails to compile.
 */
export const STEP_SURFACE_PERMISSION = {
  'browser.navigate': { surface: 'browser', action: 'navigate' },
  'browser.fill': { surface: 'browser', action: 'fill' },
  'browser.click': { surface: 'browser', action: 'click' },
  'browser.assert': { surface: 'browser', action: 'assert' },
  'browser.expect_one_of': { surface: 'browser', action: 'expect_one_of' },
  'browser.extract': { surface: 'browser', action: 'extract' },
  'terminal.connect': { surface: 'terminal', action: 'connect' },
  'terminal.type': { surface: 'terminal', action: 'type' },
  'terminal.press': { surface: 'terminal', action: 'press' },
  'terminal.read': { surface: 'terminal', action: 'read' },
  'terminal.expect_screen': { surface: 'terminal', action: 'expect_screen' },
} as const satisfies Record<string, StepPermission>;

export type PermissionedStepType = keyof typeof STEP_SURFACE_PERMISSION;

/** The permission a step type consumes, or undefined if it consumes no surface. */
export function stepPermissionFor(stepType: string): StepPermission | undefined {
  return stepType in STEP_SURFACE_PERMISSION
    ? STEP_SURFACE_PERMISSION[stepType as PermissionedStepType]
    : undefined;
}

/**
 * Whether a permissions declaration grants a surface at all.
 *
 * One place that answers it, so "absent means denied" is stated once rather
 * than re-derived at each call site.
 */
export function grantsSurface(permissions: Permissions, surface: ExecutionSurface): boolean {
  return permissions[surface] !== undefined;
}

/** Evidence capture consumes its own grants, separate from the step action. */
export const EVIDENCE_TO_BROWSER_ACTION = {
  captureScreenshot: 'screenshot',
  captureDomSnapshot: 'dom_snapshot',
} as const satisfies Record<string, BrowserAction>;

/** Only these URL protocols are permitted; file:, data:, and javascript: are rejected. */
export const ALLOWED_URL_PROTOCOLS = ['http:', 'https:'] as const;

/**
 * The surfaces a workflow's steps actually run on.
 *
 * Derived from the steps rather than from `permissions`, because a declaration
 * is what an agent is *allowed* to touch and this is what it *will* touch. The
 * runtime opens an executor per surface in this set, so an agent that contains
 * no step for a surface never opens a session on it.
 *
 * Takes step types rather than steps so this module stays free of a dependency
 * on the step union, which imports it.
 */
export function surfacesUsedBy(stepTypes: Iterable<string>): ReadonlySet<ExecutionSurface> {
  const surfaces = new Set<ExecutionSurface>();
  for (const stepType of stepTypes) {
    const permission = stepPermissionFor(stepType);
    if (permission !== undefined) {
      surfaces.add(permission.surface);
    }
  }
  return surfaces;
}
