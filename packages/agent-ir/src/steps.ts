import { errorCodeSchema, terminalBusinessOutcomeSchema } from '@orbit/contracts';
import { z } from 'zod';

import { assertionSchema } from './assertions';
import { identifierSchema } from './declarations';
import { locatorSchema } from './locator';
import { screenAddressSchema, screenFingerprintSchema } from '@orbit/screen-mapping';

/** Agent IR step identifiers are workflow-local names, not persisted entity IDs. */
export const stepIdSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);

/** A source SOP step reference; validated against the agent's declared registry. */
export const sopStepIdSchema = z.string().min(1);

export const evidenceSchema = z.strictObject({
  captureScreenshot: z.boolean().optional(),
  captureDomSnapshot: z.boolean().optional(),
});
export type Evidence = z.infer<typeof evidenceSchema>;

const timeoutMsSchema = z.number().int().positive();

/**
 * Every executable step carries at least one source SOP step ID. This is what
 * makes Watchtower's expected-versus-observed view possible, and it is required
 * rather than optional so traceability cannot quietly be dropped.
 */
const stepBase = {
  id: stepIdSchema,
  sourceSopStepIds: z.array(sopStepIdSchema).min(1),
};

export const extractFieldSchema = z.strictObject({
  locator: locatorSchema,
  method: z.enum(['text']),
});
export type ExtractField = z.infer<typeof extractFieldSchema>;

export const expectOneOfAlternativeSchema = z.strictObject({
  whenVisible: locatorSchema,
  next: stepIdSchema,
});
export type ExpectOneOfAlternative = z.infer<typeof expectOneOfAlternativeSchema>;

export const browserNavigateStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal('browser.navigate'),
  url: z.string().min(1),
  timeoutMs: timeoutMsSchema.optional(),
  evidence: evidenceSchema.optional(),
  assertions: z.array(assertionSchema).optional(),
});

export const browserFillStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal('browser.fill'),
  locator: locatorSchema,
  value: z.string().min(1),
  timeoutMs: timeoutMsSchema.optional(),
  evidence: evidenceSchema.optional(),
});

export const browserClickStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal('browser.click'),
  locator: locatorSchema,
  timeoutMs: timeoutMsSchema.optional(),
  evidence: evidenceSchema.optional(),
});

export const browserAssertStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal('browser.assert'),
  assertion: assertionSchema,
  timeoutMs: timeoutMsSchema.optional(),
  evidence: evidenceSchema.optional(),
});

/**
 * Resolves which of several known UI states occurred, and branches explicitly.
 *
 * At least two alternatives are required: a single alternative is not a choice
 * and is better expressed as a `browser.assert` with `locator_visible`.
 */
export const browserExpectOneOfStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal('browser.expect_one_of'),
  alternatives: z.array(expectOneOfAlternativeSchema).min(2),
  timeoutMs: timeoutMsSchema.optional(),
  evidence: evidenceSchema.optional(),
});

export const browserExtractStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal('browser.extract'),
  fields: z
    .record(identifierSchema, extractFieldSchema)
    .refine((fields) => Object.keys(fields).length > 0, 'must declare at least one field'),
  /** Maps a declared variable to a `${result.<field>}` reference of this step. */
  assign: z
    .record(identifierSchema, z.string().min(1))
    .refine((assign) => Object.keys(assign).length > 0, 'must assign at least one variable'),
  timeoutMs: timeoutMsSchema.optional(),
  evidence: evidenceSchema.optional(),
});

/**
 * One thing a judged decision is allowed to conclude.
 *
 * `outcome` is a classification label, not a terminal business outcome. It is
 * deliberately *not* checked against the agent's `complete` steps: a branch
 * leads to more work, and "available" or "delayed_at_carrier" are perfectly
 * good things to conclude on the way to an outcome the workflow declares later.
 * What it must be is a stable identifier, unique within its step, so the
 * evidence trail names the same conclusion the same way every time.
 *
 * `description` is what the judge is actually shown for this alternative, so it
 * carries the author's meaning rather than leaving the model to infer it from a
 * snake_case name.
 */
export const modelDecideAlternativeSchema = z.strictObject({
  outcome: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  description: z.string().min(1),
  next: stepIdSchema,
  /**
   * Marks the alternative meaning *the evidence does not settle this*.
   *
   * Exactly one is required, and that is a refusal rather than a warning
   * (ADR-032). A judged step whose alternatives are `senior | professional |
   * standard` forces a confident answer for a record carrying no evidence
   * either way, and `standard` returned because nothing else fit is
   * indistinguishable in the run's evidence from `standard` returned because it
   * was right. Where this alternative leads is the author's business decision;
   * nothing forces it to a human.
   */
  insufficientEvidence: z.boolean().optional(),
});
export type ModelDecideAlternative = z.infer<typeof modelDecideAlternativeSchema>;

/**
 * One region of the page a judged decision is allowed to read.
 *
 * The judge is shown declared regions rather than the whole page, and that is a
 * security property as much as a cost one: page content becomes model input, so
 * the smaller and more deliberate the input, the smaller the surface a hostile
 * page has to talk to the judge through. It also means the executor needs no
 * new capability — reading an element's text is something it already did — so
 * @orbit/executor-playwright is untouched by judged decisions entirely.
 *
 * A region may name a container whose *contents* vary, which is the case this
 * whole step type exists for: the surface changes, the locator does not.
 */
export const modelDecideSourceSchema = z.strictObject({
  label: identifierSchema,
  locator: locatorSchema,
});
export type ModelDecideSource = z.infer<typeof modelDecideSourceSchema>;

/**
 * A decision a model makes, bounded to a closed list the runtime already holds.
 *
 * The deterministic `browser.expect_one_of` resolves by the visibility of a
 * demonstrated element, which is exactly right when a page states its condition
 * the same way every time and useless the moment the same meaning arrives in
 * different words. This step maps a messier page onto pre-declared alternatives
 * — and that is its whole job. It does not decide what to do, find an element,
 * or recover from a failure.
 *
 * The widest thing the model can do here is pick a number between 0 and n-1.
 * `next` comes from this definition, never from the answer.
 */
export const modelDecideStepSchema = z
  .strictObject({
    ...stepBase,
    type: z.literal('model.decide'),
    question: z.string().min(1),
    readFrom: z.array(modelDecideSourceSchema).min(1),
    alternatives: z.array(modelDecideAlternativeSchema).min(2),
    /**
     * The minimum confidence this step accepts, 0 to 1.
     *
     * Per step, because a decision routing to a refund and one routing to a
     * second lookup do not deserve the same bar. Absent means the deployment's
     * conservative default applies, which the runtime owns rather than this
     * contract: a threshold baked into a published Agent Version could never be
     * raised across a fleet.
     */
    confidenceThreshold: z.number().min(0).max(1).optional(),
    timeoutMs: timeoutMsSchema.optional(),
    evidence: evidenceSchema.optional(),
  })
  .refine(
    (step) =>
      new Set(step.alternatives.map((one) => one.outcome)).size === step.alternatives.length,
    { message: 'each alternative must declare a distinct outcome name', path: ['alternatives'] },
  )
  .refine((step) => new Set(step.readFrom.map((one) => one.label)).size === step.readFrom.length, {
    message: 'each source region must have a distinct label',
    path: ['readFrom'],
  })
  .refine(
    (step) => step.alternatives.filter((one) => one.insufficientEvidence === true).length === 1,
    {
      message:
        'exactly one alternative must be marked insufficientEvidence, so the judge has somewhere to go when the evidence does not settle the question',
      path: ['alternatives'],
    },
  );

export type ModelDecideStep = z.infer<typeof modelDecideStepSchema>;

/**
 * The keys a 3270 keyboard can send that mean "act on what I typed".
 *
 * A closed enum, not a string. An AID key is the moment a screen's contents are
 * transmitted to the host and a transaction happens, so which key is pressed is
 * the most consequential single value in a terminal workflow -- `PF3` backs out
 * where `Enter` commits. A free-text key name would put that behind a typo.
 */
export const aidKeySchema = z.enum([
  'enter',
  'clear',
  'pa1',
  'pa2',
  'pa3',
  'pf1',
  'pf2',
  'pf3',
  'pf4',
  'pf5',
  'pf6',
  'pf7',
  'pf8',
  'pf9',
  'pf10',
  'pf11',
  'pf12',
  'pf13',
  'pf14',
  'pf15',
  'pf16',
  'pf17',
  'pf18',
  'pf19',
  'pf20',
  'pf21',
  'pf22',
  'pf23',
  'pf24',
]);
export type AidKey = z.infer<typeof aidKeySchema>;

/**
 * Opens a terminal session against a host the version declares.
 *
 * The host is a value on the step and is checked against
 * `permissions.terminal.allowedHosts` at publish and again before the socket is
 * opened -- the same two-gate shape `browser.navigate` has (ADR-022).
 */
export const terminalConnectStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal('terminal.connect'),
  host: z.string().min(1),
  timeoutMs: timeoutMsSchema.optional(),
  evidence: evidenceSchema.optional(),
});

/**
 * Types a value into a field.
 *
 * Typing does not transmit. A 3270 keyboard fills the local buffer and nothing
 * reaches the host until an AID key is pressed, so this step is always safe in a
 * way `browser.fill` is not -- and `terminal.press` is where the consequence is.
 */
export const terminalTypeStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal('terminal.type'),
  address: screenAddressSchema,
  value: z.string().min(1),
  timeoutMs: timeoutMsSchema.optional(),
  evidence: evidenceSchema.optional(),
});

/** Sends an AID key. This is the step that makes something happen on the host. */
export const terminalPressStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal('terminal.press'),
  key: aidKeySchema,
  timeoutMs: timeoutMsSchema.optional(),
  evidence: evidenceSchema.optional(),
});

/** Reads named fields off the current screen into declared variables. */
export const terminalReadStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal('terminal.read'),
  fields: z
    .record(identifierSchema, screenAddressSchema)
    .refine((fields) => Object.keys(fields).length > 0, 'must declare at least one field'),
  assign: z
    .record(identifierSchema, z.string().min(1))
    .refine((assign) => Object.keys(assign).length > 0, 'must assign at least one variable'),
  timeoutMs: timeoutMsSchema.optional(),
  evidence: evidenceSchema.optional(),
});

/**
 * Asserts the host is showing the screen this workflow expects.
 *
 * The terminal equivalent of a fingerprint check, and it is a step rather than
 * an implicit guard because a green-screen workflow is a sequence of screens:
 * saying which one should be present is the workflow's own logic, not a
 * safety net bolted underneath it.
 */
export const terminalExpectScreenStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal('terminal.expect_screen'),
  fingerprint: screenFingerprintSchema,
  timeoutMs: timeoutMsSchema.optional(),
  evidence: evidenceSchema.optional(),
});

/**
 * Calls one operation from an imported contract.
 *
 * `operationId` names a catalog entry; there is no URL here and no template. A
 * URL with interpolation is a small program for constructing a request, which is
 * the thing ADR-018's closed locator vocabulary exists to make unrepresentable,
 * and the argument does not change because the target is an endpoint.
 *
 * `arguments` fills the operation's declared parameters by name. `assign` maps
 * response values into declared variables through **JSON Pointer** (RFC 6901),
 * not JSONPath: JSONPath has filters and wildcards and is an expression
 * language, which ADR-007 rules out.
 */
export const apiRequestStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal('api.request'),
  /** The imported catalog this operation comes from. */
  catalogId: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  operationId: z.string().min(1),
  /** Parameter name to literal or `${inputs.x}` / `${variables.x}`. */
  arguments: z.record(z.string().min(1), z.string().min(1)).optional(),
  /** Declared variable to a JSON Pointer into the response body. */
  assign: z.record(identifierSchema, z.string().startsWith('/')).optional(),
  timeoutMs: timeoutMsSchema.optional(),
  evidence: evidenceSchema.optional(),
});

export const completeStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal('complete'),
  outcome: terminalBusinessOutcomeSchema,
  outputs: z.record(identifierSchema, z.string().min(1)).optional(),
});

export const failStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal('fail'),
  errorCode: errorCodeSchema,
  message: z.string().min(1),
});

export const agentIrStepSchema = z.discriminatedUnion('type', [
  browserNavigateStepSchema,
  browserFillStepSchema,
  browserClickStepSchema,
  browserAssertStepSchema,
  browserExpectOneOfStepSchema,
  browserExtractStepSchema,
  terminalConnectStepSchema,
  terminalTypeStepSchema,
  terminalPressStepSchema,
  terminalReadStepSchema,
  terminalExpectScreenStepSchema,
  apiRequestStepSchema,
  modelDecideStepSchema,
  completeStepSchema,
  failStepSchema,
]);
export type AgentIrStep = z.infer<typeof agentIrStepSchema>;
export type AgentIrStepType = AgentIrStep['type'];

export const TERMINAL_STEP_TYPES = ['complete', 'fail'] as const;

export function isTerminalStep(step: AgentIrStep): boolean {
  return (TERMINAL_STEP_TYPES as readonly string[]).includes(step.type);
}
