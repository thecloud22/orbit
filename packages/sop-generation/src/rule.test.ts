import { describe, expect, it } from 'vitest';

import { createFakeSopProvider, respondWith } from './testing/fake-provider';
import {
  assembleRuleDecision,
  draftRuleDecision,
  type RuleDraftContext,
  type RuleProposal,
} from './rule';

/**
 * Rule drafting (ADR-040).
 *
 * Almost every test here is about *not trusting the model*. The assembly step
 * is what stands between a plausible-looking answer and a step written into a
 * revision, so the interesting cases are the ones where the model returns
 * something reasonable-sounding and wrong: a value the workflow does not read,
 * a step that does not exist, an operator that is not one of the six.
 */

const CONTEXT: RuleDraftContext = {
  ruleText: 'A file whose debt-to-income exceeds 43% is referred to a senior underwriter.',
  availableValues: [
    { name: 'loanToValue', readAtStepId: 'read_ltv' },
    { name: 'debtToIncome', readAtStepId: 'read_dti' },
    { name: 'creditScore', readAtStepId: 'read_credit_score' },
  ],
  inputs: ['loanNumber'],
  steps: [
    { id: 'open_file', kind: 'click', summary: 'Open the file' },
    { id: 'read_ltv', kind: 'extract', summary: 'Read the loan-to-value' },
    { id: 'read_dti', kind: 'extract', summary: 'Read the debt-to-income' },
    { id: 'read_credit_score', kind: 'extract', summary: 'Read the credit score' },
    { id: 'approve_file', kind: 'click', summary: 'Approve the file' },
    { id: 'escalate_file', kind: 'click', summary: 'Refer to a senior underwriter' },
  ],
};

function proposal(overrides: Partial<RuleProposal> = {}): RuleProposal {
  return {
    resolution: 'computed',
    question: 'Is debt-to-income above the limit?',
    leftValue: 'debtToIncome',
    operator: 'gt',
    rightValue: '43',
    judgement: '',
    whenTrueLabel: 'above 43%',
    whenTrueStepId: 'escalate_file',
    whenFalseLabel: 'within the limit',
    whenFalseStepId: 'approve_file',
    insertAfterStepId: 'read_dti',
    ...overrides,
  };
}

describe('assembleRuleDecision', () => {
  it('turns a threshold rule into a computed decision, carrying the sentence it came from', () => {
    const result = assembleRuleDecision(proposal(), CONTEXT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.step).toEqual({
      kind: 'decision',
      question: 'Is debt-to-income above the limit?',
      ruleText: CONTEXT.ruleText,
      resolution: 'computed',
      // The interpolation is written here rather than by the model: punctuation
      // that must be exactly right is a class of failure that need not exist.
      comparison: { left: '${variables.debtToIncome}', operator: 'gt', right: '43' },
      branches: [
        { when: 'above 43%', nextStepId: 'escalate_file' },
        // Marked rather than positional, so reordering cannot invert the rule.
        { when: 'within the limit', nextStepId: 'approve_file', otherwise: true },
      ],
    });
    expect(result.insertAfterStepId).toBe('read_dti');
  });

  it('refuses a rule about a value no step in the workflow reads', () => {
    // The load-bearing refusal. The model can produce a name that sounds exactly
    // like a real one, and the fix is to record the value rather than to reword
    // the rule -- so the message says that.
    const result = assembleRuleDecision(proposal({ leftValue: 'reserveMonths' }), CONTEXT);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.refusals[0]?.code).toBe('unknown_value');
    expect(result.refusals[0]?.message).toContain('Reserve Months');
    expect(result.refusals[0]?.message).toContain('will not work one out for itself');
  });

  it('refuses a branch routed at a step that does not exist', () => {
    const result = assembleRuleDecision(proposal({ whenTrueStepId: 'refer_to_manager' }), CONTEXT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusals.map((refusal) => refusal.code)).toContain('unknown_step');
  });

  it('refuses an operator that is not one of the six', () => {
    const result = assembleRuleDecision(proposal({ operator: 'between' }), CONTEXT);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusals.map((refusal) => refusal.code)).toContain('unusable_operator');
  });

  it('reads a bare threshold as a literal, never as a variable', () => {
    // "is not X" is a flood zone rule, not a comparison against a variable
    // called X. Treating a bare word as a reference would silently change it.
    const result = assembleRuleDecision(
      proposal({ leftValue: 'creditScore', operator: 'neq', rightValue: 'X' }),
      CONTEXT,
    );

    expect(result.ok).toBe(true);
    if (!result.ok || result.step.kind !== 'decision') return;
    expect(result.step.comparison?.right).toBe('X');
  });

  it('resolves a run input when the rule is about one', () => {
    const result = assembleRuleDecision(
      proposal({ leftValue: 'loanNumber', operator: 'eq', rightValue: 'ML-26-04471' }),
      CONTEXT,
    );

    expect(result.ok).toBe(true);
    if (!result.ok || result.step.kind !== 'decision') return;
    expect(result.step.comparison?.left).toBe('${inputs.loanNumber}');
  });

  it('accepts a judged rule and gives it somewhere to go when the note settles nothing', () => {
    const result = assembleRuleDecision(
      proposal({
        resolution: 'judged',
        judgement: 'Read the income note and say whether the income is seasonal.',
        leftValue: '',
        operator: '',
        rightValue: '',
      }),
      CONTEXT,
    );

    expect(result.ok).toBe(true);
    if (!result.ok || result.step.kind !== 'decision') return;

    expect(result.step.resolution).toBe('judged');
    // ADR-032 requires exactly one, and it is routed alongside "the condition
    // does not hold" rather than at a destination nobody chose.
    const uncertain = result.step.branches.filter((branch) => branch.insufficientEvidence === true);
    expect(uncertain).toHaveLength(1);
    expect(uncertain[0]?.nextStepId).toBe('approve_file');
  });

  it('refuses a judged rule with nothing written about what to weigh', () => {
    const result = assembleRuleDecision(
      proposal({ resolution: 'judged', judgement: '  ' }),
      CONTEXT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusals.map((refusal) => refusal.code)).toContain('missing_judgement');
  });
});

describe('draftRuleDecision', () => {
  it('shows the model the closed lists it must choose from', async () => {
    const provider = createFakeSopProvider({
      respond: () => respondWith({}),
      respondToRule: () => respondWith(proposal()),
    });

    await draftRuleDecision({ provider, context: CONTEXT });

    // Asserted on the request rather than the answer: the whole safety argument
    // is that the model is choosing from what it was shown.
    expect(provider.ruleRequests[0]?.availableValues.map((value) => value.name)).toEqual([
      'loanToValue',
      'debtToIncome',
      'creditScore',
    ]);
    expect(provider.ruleRequests[0]?.steps).toHaveLength(6);
  });

  it('reports a provider failure as one, rather than as an unusable answer', async () => {
    const provider = createFakeSopProvider({
      respond: () => respondWith({}),
      respondToRule: () => ({ kind: 'throw', message: 'the model is unreachable' }),
    });

    const result = await draftRuleDecision({ provider, context: CONTEXT });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('provider_failed');
  });

  it('reports an answer that is not in the schema at all', async () => {
    const provider = createFakeSopProvider({
      respond: () => respondWith({}),
      respondToRule: () => respondWith({ nonsense: true }),
    });

    const result = await draftRuleDecision({ provider, context: CONTEXT });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unusable_proposal');
  });

  it('refuses before the provider is touched when the budget is spent', async () => {
    const provider = createFakeSopProvider({
      respond: () => respondWith({}),
      respondToRule: () => respondWith(proposal()),
    });

    const result = await draftRuleDecision({
      provider,
      context: CONTEXT,
      budgets: { global: 100 },
      spend: { global: 500 },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('budget_exhausted');
    // Nothing was billed, because nothing was called.
    expect(provider.ruleRequests).toHaveLength(0);
  });
});
