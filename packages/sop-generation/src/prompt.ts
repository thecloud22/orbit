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
