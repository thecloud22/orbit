import type { SopRepairContext } from './provider';

/**
 * The generation prompt.
 *
 * Versioned because it is recorded in every generated revision's provenance:
 * "which prompt produced this draft?" has to stay answerable after the prompt
 * has moved on. Change the text, bump the version — they travel together.
 */
export const SOP_GENERATION_PROMPT_VERSION = 'sop-graph-generation@1';

export const SOP_GENERATION_SYSTEM_PROMPT = `You convert a business user's plain-language standard operating procedure into a structured SOP Graph.

An SOP Graph is a description of *intent*. It is never executed, and nothing you produce will drive a browser. Describe what the user means to do, not how software would do it.

Produce only the provided schema. In particular:

STEP KINDS. Use only: navigate, fill, click, extract, decision, outcome, manual_review.
- Steps run in the order you list them. A step that is not a decision falls through to the next step in the array.
- Only a decision branches, and it must have at least two branches, each naming an existing step id.
- outcome and manual_review end the workflow. Every path must reach one, and the last step in the array must be one.
- Step ids are lowercase letters, digits and underscores, starting with a letter.

NEVER INVENT IMPLEMENTATION DETAIL. Do not produce CSS selectors, XPath, Playwright locators, data-testid values, code, expressions, credentials, domain permissions, or database ids. Describe a field or a control the way the user described it: "the field labelled Password", "the Search button".

VALUES. A fill value is either literal text or exactly one whole-string reference: \${inputs.someInput} or \${variables.someVariable}. Never concatenate, never write an expression.

INPUTS AND VARIABLES. Declare every value a run must supply as an input. A variable must be produced by an earlier extract step, or by a decision's "produces", on *every* path that reaches the step using it. An outcome may return a value that only some paths produce, but that return must be marked optional.

SECRETS. A password or similar is declared as an input of type "secret" and referenced by id, e.g. \${inputs.password}, on a fill step marked sensitive. Never write a literal secret value anywhere in the graph. A secret may be referenced only from a fill step's value.

URLS. A url the user mentions goes in a navigate step's urlHint as written. It is an untrusted draft reference; do not correct, complete, or invent one.

PRESERVE UNCERTAINTY. Do not quietly invent missing business detail. When something is unclear:
- record what you assumed in "assumptions", with the rationale;
- ask about it in "clarificationQuestions", tied to the step it concerns;
- route genuinely ambiguous or risky situations to a manual_review step rather than guessing.

DO NOT AUTO-REMEDIATE. If the user describes a condition to stop on, route it to manual_review. Never add a recovery, reset, retry, or fix-up step the user did not ask for.

RISKS. Note anything that could change an external system, or that you are unsure is read-only, in "risks".`;

/** The human turn: the source text, plus what went wrong last time on a repair. */
export function buildGenerationMessage(
  sourceText: string,
  repairContext: SopRepairContext | undefined,
): string {
  if (repairContext === undefined) {
    return `Convert the following standard operating procedure into an SOP Graph.\n\n<sop>\n${sourceText}\n</sop>`;
  }

  const issues = repairContext.issues
    .map((issue) => {
      const where = issue.path.length === 0 ? 'the document' : issue.path.join('.');
      const step = issue.stepId === undefined ? '' : ` (step "${issue.stepId}")`;
      return `- [${issue.code}] at ${where}${step}: ${issue.message}`;
    })
    .join('\n');

  return `Your previous SOP Graph was rejected by validation. Produce a corrected graph for the same procedure.

<sop>
${sourceText}
</sop>

<previous-attempt>
${JSON.stringify(repairContext.previousAttempt, null, 2)}
</previous-attempt>

<validation-issues>
${issues}
</validation-issues>

Fix every issue listed. Keep everything that was already correct. Do not drop steps, inputs, assumptions, or clarification questions that were not the subject of an issue.`;
}

/**
 * The rule-drafting prompt (ADR-040).
 *
 * Versioned separately from generation, and for the same reason: it is recorded
 * with what it produced, and "which prompt drafted this rule?" has to stay
 * answerable after the text moves on.
 *
 * The whole prompt is about *not* inventing. The model is handed the values the
 * workflow reads and the steps it contains, and every name it returns is looked
 * up against those lists before anything is assembled — so the instruction to
 * copy names exactly is a courtesy that makes refusals rarer, not the thing
 * keeping the output safe.
 */
export const RULE_DRAFTING_PROMPT_VERSION = 'rule-decision-drafting@1';

export const RULE_DRAFTING_SYSTEM_PROMPT = `You turn one written business rule into a decision step for an existing workflow.

You are given the rule, the values the workflow already reads, and the steps it already contains. Your job is to say what should be compared, and where each answer leads.

CHOOSE THE RESOLUTION HONESTLY.
- "computed" when the rule is a threshold or an exact match against a value the workflow reads: "over 80%", "below 620", "not in zone X". This is the common case and it costs nothing to run.
- "judged" only when the condition genuinely requires reading prose and forming an opinion: "income that needs two years of returns to stand up". Never choose judged for something a number settles.

NEVER INVENT A VALUE. The value being tested must be copied exactly from the list of values the workflow reads. If the rule is about a figure that is not on that list, still say which value it would need — do not substitute a different one, and do not try to derive it from two others. There is no arithmetic available to you: no ratios, no sums, no percentages of anything.

OPERATORS ARE EXACT. "exceeds 43%" and "over 80%" are gt, not gte. "at least 620" is gte. "below 620" is lt. "is not X" is neq. Read the rule's wording literally — a threshold written one way and applied the other is a rule quietly changed.

THRESHOLDS ARE BARE. Write 80, not "80%". Write 806500, not "$806,500". The value the workflow reads may be rendered with a percent sign or a currency symbol; the threshold you write should not be.

ONE CONDITION ONLY. There is no "and" and no "or". If the rule has two conditions, write the decision for the first one and route it so a second rule can follow.

ROUTE TO REAL STEPS. Both destinations, and the step to insert after, must be exact ids copied from the steps you were given. Place the rule after every step that reads a value it uses — a rule cannot test a figure the run has not read yet.

RESTATE, DO NOT REINTERPRET. The question should be the rule as a yes-or-no question in the business's own words. Do not broaden it, narrow it, or add a condition nobody wrote.`;

/** The one message: the rule, and the closed lists it may draw names from. */
export function buildRuleDraftingMessage(input: {
  readonly ruleText: string;
  readonly availableValues: readonly { readonly name: string; readonly readAtStepId: string }[];
  readonly inputs: readonly string[];
  readonly steps: readonly {
    readonly id: string;
    readonly kind: string;
    readonly summary: string;
  }[];
}): string {
  const values =
    input.availableValues.length === 0
      ? '(none — this workflow reads no values yet)'
      : input.availableValues
          .map((value) => `- ${value.name} (read at step "${value.readAtStepId}")`)
          .join('\n');

  const inputs =
    input.inputs.length === 0 ? '(none)' : input.inputs.map((name) => `- ${name}`).join('\n');

  const steps = input.steps.map((step) => `- ${step.id} [${step.kind}] ${step.summary}`).join('\n');

  return `THE RULE
${input.ruleText}

VALUES THIS WORKFLOW READS, in the order they are read
${values}

RUN INPUTS, available at every step
${inputs}

STEPS IN THIS WORKFLOW, in order
${steps}`;
}
