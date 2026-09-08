import { z } from 'zod';

import { identifierSchema, producedValueSchema } from './declarations';

/**
 * The SOP Graph step vocabulary.
 *
 * Seven kinds, describing business and browser *intent* only. There is
 * deliberately no field anywhere in this file that could hold a CSS selector, an
 * XPath, a Playwright locator, a `data-testid`, a code expression, or a
 * credential: a step says "the field labelled Password", never "how to find it".
 * Turning a hint into something a browser can act on is a later, separately
 * reviewed mapping step, and nothing here anticipates it.
 */

/** Step ids are workflow-local names a reviewer can read, not persisted entity ids. */
export const stepIdSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);

/** A named outcome the workflow can reach, e.g. `completed`, `not_found`. */
export const outcomeNameSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);

const stepBase = {
  id: stepIdSchema,
  /** Why this step exists, in the author's words. Shown to reviewers. */
  purpose: z.string().min(1),
};

export const extractFieldSchema = z.strictObject({
  name: identifierSchema,
  /** How the value is labelled on screen, as the author described it. */
  labelHint: z.string().min(1),
  required: z.boolean(),
});
export type ExtractField = z.infer<typeof extractFieldSchema>;

export const branchSchema = z.strictObject({
  /** The condition in plain language, e.g. "more than one result". */
  when: z.string().min(1),
  nextStepId: stepIdSchema,
  /**
   * Marks the branch meaning *the evidence does not settle this*.
   *
   * Only meaningful on a judged decision, where exactly one is required
   * (ADR-032). Still business intent rather than implementation: "we could not
   * tell" is a real business case, and a workflow that has nowhere to put it
   * has to invent a confident answer instead.
   */
  insufficientEvidence: z.boolean().optional(),
});
export type Branch = z.infer<typeof branchSchema>;

/**
 * A value an outcome returns.
 *
 * `optional` is the answer to the requirements document's `onCallEngineer`
 * case: a value produced only on some paths may still be returned, but the
 * graph has to say so. Silently returning a value that may not exist is what
 * this flag makes impossible.
 */
export const outcomeReturnSchema = z.strictObject({
  name: identifierSchema,
  optional: z.boolean().optional(),
});
export type OutcomeReturn = z.infer<typeof outcomeReturnSchema>;

export const navigateStepSchema = z.strictObject({
  ...stepBase,
  kind: z.literal('navigate'),
  /** An untrusted draft reference. Never fetched, probed, or resolved. */
  urlHint: z.string().min(1).optional(),
  systemHint: z.string().min(1).optional(),
});

export const fillStepSchema = z.strictObject({
  ...stepBase,
  kind: z.literal('fill'),
  fieldHint: z.string().min(1),
  /** A literal, `${inputs.id}`, or `${variables.name}` — nothing else. */
  value: z.string().min(1),
  /** Marks a field whose value must come from a declared secret input. */
  sensitive: z.boolean().optional(),
});

export const clickStepSchema = z.strictObject({
  ...stepBase,
  kind: z.literal('click'),
  targetHint: z.string().min(1),
});

export const extractStepSchema = z.strictObject({
  ...stepBase,
  kind: z.literal('extract'),
  fields: z.array(extractFieldSchema).min(1),
  /** What a missing value means. Defaults to failing the step. */
  onMissing: z.enum(['fail', 'continue_with_note']).optional(),
});

/**
 * A branch point. At least two branches: one is not a decision, and expressing
 * it as one would hide an unconditional step inside a conditional shape.
 */
export const decisionStepSchema = z.strictObject({
  id: stepIdSchema,
  kind: z.literal('decision'),
  question: z.string().min(1),
  purpose: z.string().min(1).optional(),
  usesInputs: z.array(identifierSchema).optional(),
  usesVariables: z.array(identifierSchema).optional(),
  /** Values the decision itself derives, e.g. `isStaleEscalation`. */
  produces: z.array(producedValueSchema).optional(),
  branches: z.array(branchSchema).min(2),
  /**
   * How this decision is resolved at run time. Deterministic by default.
   *
   * `demonstrated` is Task 8's branch: each condition is bound to an element a
   * person put on screen, and the run picks by what is visible. Free, exact,
   * and useless the moment the same meaning arrives in different words.
   *
   * `judged` asks a model to classify page text into these same branches
   * (ADR-032). It costs money, needs `permissions.model`, and is the only
   * non-deterministic thing in an execution. So it is opt-in per step and never
   * a fallback the system reaches for on its own: choosing it is a review-time
   * decision a person makes, not a run-time one.
   *
   * `judgement` says what the model should weigh, in the author's own words.
   * Required for a judged decision and meaningless otherwise.
   */
  resolution: z.enum(['demonstrated', 'judged']).optional(),
  judgement: z.string().min(1).optional(),
});

/**
 * Looking something up in, or handing something to, another system.
 *
 * Business intent only, like every other kind here. It says *what* is being
 * asked for and roughly *where* -- "look up the customer record", "in
 * Salesforce" -- and carries no endpoint, method, payload or authentication.
 * Which API operation actually answers it is a separately reviewed mapping,
 * exactly as which element a click lands on is (ADR-002).
 *
 * There is deliberately no `urlHint` counterpart to `navigate`'s. A URL a person
 * typed into a draft is a plausible-looking thing that binding would be tempted
 * to trust, and an endpoint is a more consequential thing to guess at than a
 * page: a step named against a real contract can be checked, a step named
 * against a remembered URL cannot.
 */
export const callStepSchema = z.strictObject({
  ...stepBase,
  kind: z.literal('call'),
  /** What is being asked for, in the author's words. */
  requestHint: z.string().min(1),
  /** Which system, as the author named it. Never resolved or fetched. */
  systemHint: z.string().min(1),
  /** Values the call is expected to return, so downstream steps can be checked. */
  produces: z.array(producedValueSchema).optional(),
});

export const outcomeStepSchema = z.strictObject({
  id: stepIdSchema,
  kind: z.literal('outcome'),
  outcome: outcomeNameSchema,
  message: z.string().min(1),
  purpose: z.string().min(1).optional(),
  returns: z.array(outcomeReturnSchema).optional(),
});

export const manualReviewStepSchema = z.strictObject({
  id: stepIdSchema,
  kind: z.literal('manual_review'),
  reason: outcomeNameSchema,
  message: z.string().min(1),
  purpose: z.string().min(1).optional(),
  handoff: z.string().min(1).optional(),
});

export const sopStepSchema = z.discriminatedUnion('kind', [
  navigateStepSchema,
  fillStepSchema,
  clickStepSchema,
  extractStepSchema,
  callStepSchema,
  decisionStepSchema,
  outcomeStepSchema,
  manualReviewStepSchema,
]);
export type SopStep = z.infer<typeof sopStepSchema>;
export type SopStepKind = SopStep['kind'];

/**
 * A step being added, before it has an identity.
 *
 * Ids are generated rather than typed by a person (`generateStepId`), so the
 * shape that arrives from an editor is every step field except `id`. Built by
 * omitting from the real schemas rather than restated, so a field added to a
 * step kind cannot be silently missing here.
 */
export const sopStepDraftSchema = z.discriminatedUnion('kind', [
  navigateStepSchema.omit({ id: true }),
  fillStepSchema.omit({ id: true }),
  clickStepSchema.omit({ id: true }),
  extractStepSchema.omit({ id: true }),
  callStepSchema.omit({ id: true }),
  decisionStepSchema.omit({ id: true }),
  outcomeStepSchema.omit({ id: true }),
  manualReviewStepSchema.omit({ id: true }),
]);
export type SopStepDraft = z.infer<typeof sopStepDraftSchema>;

/**
 * A readable, unique id for a newly inserted step.
 *
 * Generated, never asked for. A step id is workflow-local naming rather than a
 * persisted entity id, but branches name their targets by it and the step
 * editor refuses to change one, so a person choosing badly here is a mistake
 * they cannot undo. The same reasoning made `agentIdForDocument` derived rather
 * than entered (ADR-024).
 *
 * Named after the kind and numbered from the count of that kind, so a graph
 * reads as `click_1`, `click_2`. The suffix is a *starting guess* and the loop
 * is what guarantees uniqueness: a step called `click_2` may already exist
 * because an earlier one was deleted, or because a person wrote that name by
 * hand in a fixture.
 */
export function generateStepId(existingIds: Iterable<string>, kind: SopStepKind): string {
  const taken = new Set(existingIds);

  let suffix = 1;
  for (const id of taken) {
    if (id === kind || id.startsWith(`${kind}_`)) {
      suffix += 1;
    }
  }

  let candidate = `${kind}_${String(suffix)}`;
  while (taken.has(candidate)) {
    suffix += 1;
    candidate = `${kind}_${String(suffix)}`;
  }

  return candidate;
}

export const SOP_STEP_KINDS = [
  'navigate',
  'fill',
  'click',
  'extract',
  'call',
  'decision',
  'outcome',
  'manual_review',
] as const;

/** `outcome` and `manual_review` end the workflow and have no successor. */
export const TERMINAL_STEP_KINDS = ['outcome', 'manual_review'] as const;

export function isTerminalStep(step: SopStep): boolean {
  return (TERMINAL_STEP_KINDS as readonly string[]).includes(step.kind);
}

/** The variables a step makes available to everything downstream of it. */
export function producedBy(step: SopStep): readonly string[] {
  if (step.kind === 'extract') {
    return step.fields.map((field) => field.name);
  }

  if (step.kind === 'decision' || step.kind === 'call') {
    return (step.produces ?? []).map((produced) => produced.name);
  }

  return [];
}

/** Extract fields declared `required: false`, which may legitimately be absent. */
export function optionallyProducedBy(step: SopStep): readonly string[] {
  return step.kind === 'extract'
    ? step.fields.filter((field) => !field.required).map((field) => field.name)
    : [];
}
