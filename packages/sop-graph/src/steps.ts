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
  /**
   * A short label grouping this step with its neighbors under one heading in
   * the reviewer-facing step list, e.g. "Look up the member". Purely
   * presentational: it does not affect compilation, binding, or execution,
   * and carries no meaning the compiler or runtime ever reads. Consecutive
   * steps sharing the same label render under one heading; a step with none
   * renders on its own, exactly as every step does today.
   */
  group: z.string().min(1).optional(),
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
  /**
   * Marks the branch meaning *the condition did not hold*.
   *
   * Required on a computed decision, where exactly one of the two branches must
   * carry it, and meaningless on the other two resolutions. A comparison
   * answers yes or no, so which branch is the "no" could have been read off
   * position -- and a graph where reordering two branches silently inverts a
   * lending decision is a graph nobody should have to review that carefully.
   */
  otherwise: z.boolean().optional(),
});
export type Branch = z.infer<typeof branchSchema>;

/**
 * How two values are compared, as a closed vocabulary.
 *
 * Six operators and nothing else -- no arithmetic, no combination, no negation
 * of a compound. A rule needing "LTV over 80 *and* a second home" is two
 * decisions in sequence, which is also how it reads to the person reviewing the
 * workflow. The moment this grows an `and` it has become an expression language,
 * and the reason ADR-007 refuses one is that an expression is a small program
 * nobody reviewed.
 */
export const comparisonOperatorSchema = z.enum(['gt', 'gte', 'lt', 'lte', 'eq', 'neq']);
export type ComparisonOperator = z.infer<typeof comparisonOperatorSchema>;

/**
 * A comparison a computed decision resolves by, deterministically.
 *
 * Both sides are values in the same restricted grammar the rest of the graph
 * uses (`values.ts`): a literal, or one whole-string `${variables.x}` /
 * `${inputs.y}` reference. So "is loan-to-value over 80" is
 * `${variables.loanToValue} gt 80`, and "is the loan over the conforming limit"
 * -- a threshold the screen itself publishes -- is
 * `${variables.loanAmount} gt ${variables.conformingLimit}`, with no new syntax
 * for either.
 *
 * What this deliberately cannot express is a value that does not already exist.
 * There is no ratio operator, no sum: if a rule is about loan-to-value then some
 * step has to produce loan-to-value, and the compiler refuses the rule until one
 * does. Orbit reads figures a system of record computed and stands behind; it
 * does not become a second, unaudited calculator sitting next to it.
 */
export const comparisonSchema = z.strictObject({
  left: z.string().min(1),
  operator: comparisonOperatorSchema,
  right: z.string().min(1),
});
export type Comparison = z.infer<typeof comparisonSchema>;

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
  /** See `stepBase`'s `group` -- purely presentational. */
  group: z.string().min(1).optional(),
  /**
   * The business rule this decision came from, in the words it was written in.
   *
   * Set when a decision was authored as a rule -- "if debt-to-income is over
   * 43%, refer the file to a senior underwriter" -- rather than drawn on a
   * canvas. It is documentation with a job: the compiled step is what runs, and
   * this is the sentence a reviewer checks it against, so a decision whose
   * threshold was quietly edited can be caught by reading it next to the rule it
   * claims to implement. Never read by the compiler or the runtime.
   */
  ruleText: z.string().min(1).optional(),
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
   *
   * `computed` compares two values the workflow already holds and takes the
   * branch the answer selects (ADR-038). It is the resolution a written business
   * rule usually wants: a lender's PMI threshold is a number, not a matter of
   * opinion, and routing it through a model would buy nothing and cost
   * determinism, money and latency. Free, instant, and identical on every run.
   *
   * `comparison` carries that comparison. Required for a computed decision and
   * meaningless otherwise.
   */
  resolution: z.enum(['demonstrated', 'judged', 'computed']).optional(),
  judgement: z.string().min(1).optional(),
  comparison: comparisonSchema.optional(),
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
  /** See `stepBase`'s `group` -- purely presentational. */
  group: z.string().min(1).optional(),
});

export const manualReviewStepSchema = z.strictObject({
  id: stepIdSchema,
  kind: z.literal('manual_review'),
  reason: outcomeNameSchema,
  message: z.string().min(1),
  purpose: z.string().min(1).optional(),
  handoff: z.string().min(1).optional(),
  /** See `stepBase`'s `group` -- purely presentational. */
  group: z.string().min(1).optional(),
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

/** The longest a derived id gets before it stops being easier to read than a number. */
const MAX_SLUG_LENGTH = 40;

/**
 * Turns a label a person wrote into something that satisfies the id grammar.
 *
 * Returns null when nothing usable survives — an empty label, or one made
 * entirely of punctuation — so a caller falls back rather than producing `_` or
 * an id that starts with a digit.
 *
 * Truncation cuts back to the last word boundary rather than mid-word, because
 * the entire reason for deriving an id from words is that somebody reads it
 * afterwards, and `attach_the_mortgage_insurance_conditio` is worse than a
 * number would have been.
 */
export function slugForStepId(label: string): string | null {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (slug === '' || !/^[a-z]/.test(slug)) {
    return null;
  }

  if (slug.length <= MAX_SLUG_LENGTH) {
    return slug;
  }

  const cut = slug.slice(0, MAX_SLUG_LENGTH);
  const boundary = cut.lastIndexOf('_');

  return (boundary > 0 ? cut.slice(0, boundary) : cut).replace(/_+$/, '');
}

/**
 * The words a step is named after, when it has any.
 *
 * A decision is named after its question and everything else after its purpose,
 * which is the same field `describeStep` shows a reviewer. That is the point:
 * the id and the label a person reads come from one sentence, so they cannot
 * describe different things.
 */
function labelForStepId(step: SopStepDraft): string | null {
  if (step.kind === 'decision') {
    return step.question;
  }

  if (step.kind === 'outcome' || step.kind === 'manual_review') {
    return step.purpose ?? step.message;
  }

  return step.purpose;
}

/**
 * A readable, unique id for a newly inserted step.
 *
 * Generated, never asked for. A step id is workflow-local naming rather than a
 * persisted entity id, but branches name their targets by it, bindings key on
 * it, and published Agent IR carries it in `sourceSopStepIds` — so it cannot be
 * changed afterwards, and a person choosing badly here would be making a
 * mistake they could not undo. The same reasoning made `agentIdForDocument`
 * derived rather than entered (ADR-024).
 *
 * Derived from what the step is *for*, when the draft says: a decision asking
 * "Is debt-to-income above the limit?" becomes
 * `is_debt_to_income_above_the_limit` rather than `decision_2`. Nobody is asked
 * to name anything — the sentence is one they were already writing — and it
 * matches what the recorder has always done with the label on an element, so
 * both ways into a workflow now produce ids of the same quality.
 *
 * Falls back to the kind, numbered from the count of that kind, when there is
 * no usable label. The suffix is a *starting guess* in both paths and the loop
 * is what guarantees uniqueness: a step called `click_2` may already exist
 * because an earlier one was deleted, or because a person wrote that name by
 * hand in a fixture.
 */
export function generateStepId(
  existingIds: Iterable<string>,
  step: SopStepKind | SopStepDraft,
): string {
  const taken = new Set(existingIds);
  const kind = typeof step === 'string' ? step : step.kind;
  const slug = typeof step === 'string' ? null : slugForStepId(labelForStepId(step) ?? '');

  // A derived name wants the bare words when they are free -- `check_the_floor`,
  // not `check_the_floor_1`. The numbered fallback always numbers, because
  // `click` on its own says nothing a reader can use.
  if (slug !== null) {
    return firstFree(taken, slug, taken.has(slug) ? 2 : null);
  }

  return firstFree(taken, kind, countOf(taken, kind) + 1);
}

/** How many ids already look like they were numbered off this base. */
function countOf(taken: ReadonlySet<string>, base: string): number {
  let count = 0;

  for (const id of taken) {
    if (id === base || id.startsWith(`${base}_`)) {
      count += 1;
    }
  }

  return count;
}

/**
 * `base` when `suffix` is null, otherwise `base_2`, `base_3` — whichever is free.
 *
 * The starting suffix is a *guess* in both paths and the loop is what guarantees
 * uniqueness: a step called `click_2` may already exist because an earlier one
 * was deleted, or because somebody wrote that name by hand in a fixture.
 */
function firstFree(taken: ReadonlySet<string>, base: string, suffix: number | null): string {
  if (suffix === null) {
    return base;
  }

  let next = Math.max(suffix, 1);
  let candidate = `${base}_${String(next)}`;

  while (taken.has(candidate)) {
    next += 1;
    candidate = `${base}_${String(next)}`;
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
