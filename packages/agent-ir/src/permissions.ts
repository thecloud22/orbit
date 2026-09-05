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

export const permissionsSchema = z.strictObject({
  browser: browserPermissionsSchema,
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
