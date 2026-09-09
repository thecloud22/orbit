import { z } from 'zod';

import {
  checkModelBudget,
  type BudgetRefusal,
  type ModelBudgets,
  type ModelCallUsage,
  type ModelSpend,
} from '@orbit/model-budget';
import { comparisonOperatorSchema, describeVariable, type SopStepDraft } from '@orbit/sop-graph';

import { isSopProviderError, type LLMProvider, type ProviderDescriptor } from './provider';

/**
 * Turning a written business rule into a decision step somebody can approve.
 *
 * The front door onto ADR-040. A person writes "if debt-to-income exceeds 43%,
 * refer the file to a senior underwriter", and this proposes the decision step
 * that would enforce it — which threshold, against which value the workflow
 * already reads, and where each branch goes.
 *
 * Three things about the shape of this are deliberate.
 *
 * **The model chooses from closed lists, never from open text.** It is given
 * the values this workflow actually reads and the steps a branch may target,
 * and its answer names one of each. It cannot invent a variable, because the
 * name it returns is checked against the list it was shown before anything is
 * assembled — and a rule against a value nothing reads is the exact failure
 * ADR-040's compiler refusal exists for. Catching it here means a person is
 * told what to record rather than handed a step that will not compile.
 *
 * **It proposes; it does not apply.** The result is a step draft the existing
 * insert-and-review flow shows for approval, like every other generated thing
 * in this codebase. Nothing here writes to a revision.
 *
 * **It may answer `judged`.** A rule whose condition is genuinely a matter of
 * reading prose is not a comparison, and forcing one would produce a threshold
 * against something that is not a number. Saying so is more useful than
 * inventing arithmetic.
 */

/** What the model may name, gathered from the revision it is drafting against. */
export interface RuleDraftContext {
  /** The rule, in the words it was written in. */
  readonly ruleText: string;
  /** Values some step reads, with where they are read, in workflow order. */
  readonly availableValues: readonly { readonly name: string; readonly readAtStepId: string }[];
  /** Declared run inputs, which are available everywhere. */
  readonly inputs: readonly string[];
  /** Every step, so a branch can be routed at one and the rule placed after one. */
  readonly steps: readonly {
    readonly id: string;
    readonly kind: string;
    readonly summary: string;
  }[];
}

/**
 * The model's answer, before any of it is trusted.
 *
 * `leftValue` is a bare name rather than `${variables.x}`: the interpolation
 * syntax is this codebase's to write, and asking a model to produce punctuation
 * that must be exactly right is asking for a class of failure that need not
 * exist. The same reasoning keeps `otherwise` out of the schema — which branch
 * is the "no" follows from the comparison, so it is assembled rather than
 * answered.
 */
export const ruleProposalSchema = z.object({
  resolution: z
    .enum(['computed', 'judged'])
    .describe(
      'Use "computed" when the rule is a threshold or an exact match against a value the workflow reads. Use "judged" only when the condition needs a person or a model to read prose and form an opinion.',
    ),
  question: z
    .string()
    .min(1)
    .describe('The rule restated as a yes-or-no question, in the business’s own words.'),
  leftValue: z
    .string()
    .describe(
      'For a computed rule: the exact name of the value being tested, copied from the list of values this workflow reads. Empty for a judged rule.',
    ),
  operator: z
    .string()
    .describe(
      'For a computed rule: one of gt, gte, lt, lte, eq, neq. Empty for a judged rule. Note "exceeds 43%" is gt, not gte.',
    ),
  rightValue: z
    .string()
    .describe(
      'For a computed rule: the threshold it is compared against, as a bare number or word (80, 620, X). Empty for a judged rule.',
    ),
  judgement: z
    .string()
    .describe(
      'For a judged rule: what the model reading the page should weigh. Empty for a computed rule.',
    ),
  whenTrueLabel: z.string().min(1).describe('How the condition holding reads, e.g. "above 43%".'),
  whenTrueStepId: z
    .string()
    .min(1)
    .describe('The exact id of the step to go to when the condition holds.'),
  whenFalseLabel: z
    .string()
    .min(1)
    .describe('How the condition not holding reads, e.g. "within the limit".'),
  whenFalseStepId: z
    .string()
    .min(1)
    .describe('The exact id of the step to go to when the condition does not hold.'),
  insertAfterStepId: z
    .string()
    .min(1)
    .describe(
      'The exact id of the step this rule should be checked after. It must come after every value the rule reads.',
    ),
});
export type RuleProposal = z.infer<typeof ruleProposalSchema>;

/**
 * Why a rule could not be turned into a step.
 *
 * Named rather than collapsed into one, because they lead to different actions.
 * `unknown_value` is the one worth telling a person carefully: the rule is fine
 * and the workflow does not read the figure it is about, so the fix is to add a
 * step that reads it — not to reword the rule.
 */
export type RuleDraftRefusalCode =
  | 'unknown_value'
  | 'unknown_step'
  | 'unusable_operator'
  | 'incomplete_comparison'
  | 'missing_judgement';

export interface RuleDraftRefusal {
  readonly code: RuleDraftRefusalCode;
  readonly message: string;
}

export type RuleDraftResult =
  | { readonly ok: true; readonly step: SopStepDraft; readonly insertAfterStepId: string }
  | { readonly ok: false; readonly refusals: readonly RuleDraftRefusal[] };

/**
 * Checks the model's answer against what it was shown, and assembles the step.
 *
 * Pure, and separately testable from anything that calls a model: given a
 * proposal and the context it was drafted against, either a step draft or the
 * reasons it is not one. Every name the model returned is looked up rather than
 * trusted, which is what makes this safe to run on output nobody has read.
 */
export function assembleRuleDecision(
  proposal: RuleProposal,
  context: RuleDraftContext,
): RuleDraftResult {
  const refusals: RuleDraftRefusal[] = [];
  const stepIds = new Set(context.steps.map((step) => step.id));

  for (const [field, id] of [
    ['whenTrueStepId', proposal.whenTrueStepId],
    ['whenFalseStepId', proposal.whenFalseStepId],
    ['insertAfterStepId', proposal.insertAfterStepId],
  ] as const) {
    if (!stepIds.has(id)) {
      refusals.push({
        code: 'unknown_step',
        message: `The rule was routed to a step called "${id}" (${field}), and this workflow has no such step.`,
      });
    }
  }

  if (proposal.resolution === 'judged') {
    if (proposal.judgement.trim() === '') {
      refusals.push({
        code: 'missing_judgement',
        message:
          'This rule was read as one needing judgement, but nothing was written about what to weigh.',
      });
    }

    if (refusals.length > 0) {
      return { ok: false, refusals };
    }

    return {
      ok: true,
      insertAfterStepId: proposal.insertAfterStepId,
      step: {
        kind: 'decision',
        question: proposal.question,
        ruleText: context.ruleText,
        resolution: 'judged',
        judgement: proposal.judgement,
        branches: [
          { when: proposal.whenTrueLabel, nextStepId: proposal.whenTrueStepId },
          { when: proposal.whenFalseLabel, nextStepId: proposal.whenFalseStepId },
          // Required on a judged decision (ADR-032) and routed to the same
          // place as "the condition does not hold" rather than invented: the
          // model was not asked where uncertainty should go, and guessing at a
          // destination for it is exactly the confident-wrong-answer shape that
          // branch exists to prevent. A reviewer retargets it.
          {
            when: 'the evidence does not settle it',
            nextStepId: proposal.whenFalseStepId,
            insufficientEvidence: true,
          },
        ],
      },
    };
  }

  const operator = comparisonOperatorSchema.safeParse(proposal.operator.trim());

  if (!operator.success) {
    refusals.push({
      code: 'unusable_operator',
      message: `"${proposal.operator}" is not a comparison this can make. It has six: more than, at least, less than, at most, is, and is not.`,
    });
  }

  const left = proposal.leftValue.trim();
  const right = proposal.rightValue.trim();

  if (left === '' || right === '') {
    refusals.push({
      code: 'incomplete_comparison',
      message: 'This rule was read as a comparison, but not both sides of it were filled in.',
    });
  }

  const reference = referenceFor(left, context);

  if (left !== '' && reference === null) {
    refusals.push({
      code: 'unknown_value',
      message: `This rule is about "${describeVariable(left)}", and no step in this workflow reads that value. Add a step that reads it first — Orbit compares figures the system already shows and will not work one out for itself.`,
    });
  }

  if (refusals.length > 0 || reference === null || !operator.success) {
    return { ok: false, refusals: refusals.length > 0 ? refusals : [] };
  }

  return {
    ok: true,
    insertAfterStepId: proposal.insertAfterStepId,
    step: {
      kind: 'decision',
      question: proposal.question,
      ruleText: context.ruleText,
      resolution: 'computed',
      comparison: {
        left: reference,
        operator: operator.data,
        // Kept as the literal the model returned. A right-hand side naming
        // another variable is legal (ADR-040) but is not what a written rule
        // usually means, and reading a bare word as a reference would turn
        // "is not X" into a comparison against a variable called X.
        right,
      },
      branches: [
        { when: proposal.whenTrueLabel, nextStepId: proposal.whenTrueStepId },
        { when: proposal.whenFalseLabel, nextStepId: proposal.whenFalseStepId, otherwise: true },
      ],
    },
  };
}

/**
 * The interpolation reference for a name the model returned, or null.
 *
 * Variables win over inputs on a clash, because a value the workflow reads from
 * the page is what a rule about "the loan-to-value" means, and an input with
 * the same name would be the one the run was started with.
 */
function referenceFor(name: string, context: RuleDraftContext): string | null {
  if (context.availableValues.some((value) => value.name === name)) {
    return `\${variables.${name}}`;
  }

  if (context.inputs.includes(name)) {
    return `\${inputs.${name}}`;
  }

  return null;
}

/**
 * Drafting one rule: ask the model, then check every name it returned.
 *
 * The budget check is the same one generation makes and for the same reason —
 * a call is refused before the provider is touched, so a refusal costs nothing.
 * There is no repair attempt here, deliberately: generation repairs because a
 * whole workflow is expensive to lose, and a single rule is cheaper to re-ask
 * with a person's own correction than to have a model guess at twice.
 */
export type DraftRuleResult =
  | {
      readonly ok: true;
      readonly step: SopStepDraft;
      readonly insertAfterStepId: string;
      readonly usage: ModelCallUsage | null;
      readonly descriptor: ProviderDescriptor;
    }
  | {
      readonly ok: false;
      readonly reason: 'budget_exhausted';
      readonly refusal: BudgetRefusal;
    }
  | { readonly ok: false; readonly reason: 'provider_failed'; readonly message: string }
  | {
      readonly ok: false;
      readonly reason: 'unusable_proposal';
      readonly refusals: readonly RuleDraftRefusal[];
      readonly usage: ModelCallUsage | null;
    };

export async function draftRuleDecision(input: {
  readonly provider: LLMProvider;
  readonly context: RuleDraftContext;
  readonly budgets?: ModelBudgets;
  readonly spend?: ModelSpend;
}): Promise<DraftRuleResult> {
  const budgets = input.budgets ?? {};
  const spend = input.spend ?? { global: 0, document: 0, request: 0 };

  const allowed = checkModelBudget({ budgets, spend });

  if (!allowed.allowed) {
    return { ok: false, reason: 'budget_exhausted', refusal: allowed.refusal };
  }

  let response;

  try {
    response = await input.provider.draftRuleDecision({
      ruleText: input.context.ruleText,
      availableValues: input.context.availableValues,
      inputs: input.context.inputs,
      steps: input.context.steps,
    });
  } catch (error) {
    // Only a provider failure is converted. Anything else is a defect in this
    // process and propagates, so a bug is never disguised as a model outage.
    if (!isSopProviderError(error)) {
      throw error;
    }

    return { ok: false, reason: 'provider_failed', message: error.message };
  }

  const parsed = ruleProposalSchema.safeParse(response.proposal);

  if (!parsed.success) {
    return {
      ok: false,
      reason: 'unusable_proposal',
      usage: response.usage,
      refusals: [
        {
          code: 'incomplete_comparison',
          message: 'The model did not answer in the shape this asks for.',
        },
      ],
    };
  }

  const assembled = assembleRuleDecision(parsed.data, input.context);

  if (!assembled.ok) {
    return {
      ok: false,
      reason: 'unusable_proposal',
      refusals: assembled.refusals,
      usage: response.usage,
    };
  }

  return {
    ok: true,
    step: assembled.step,
    insertAfterStepId: assembled.insertAfterStepId,
    usage: response.usage,
    descriptor: input.provider.descriptor,
  };
}
