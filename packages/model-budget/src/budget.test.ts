import { describe, expect, it } from 'vitest';

import {
  ASSUMED_TOKENS_PER_CALL,
  checkModelBudget,
  estimateCostMicroUsd,
  FALLBACK_MODEL_RATE,
  type ModelBudgets,
  type ModelSpend,
} from './budget';

const NOTHING_SPENT: ModelSpend = { global: 0, document: 0, request: 0 };

function check(budgets: ModelBudgets, spend: Partial<ModelSpend> = {}) {
  return checkModelBudget({ budgets, spend: { ...NOTHING_SPENT, ...spend } });
}

describe('checkModelBudget', () => {
  it('allows a call when nothing is capped', () => {
    expect(check({}).allowed).toBe(true);
  });

  it('allows a call with room for the assumed size', () => {
    expect(check({ global: ASSUMED_TOKENS_PER_CALL * 2 }).allowed).toBe(true);
  });

  it('refuses before the call, not after it', () => {
    // The whole design: a ceiling with less than one call's worth of room left
    // stops the call rather than discovering afterwards that it overshot.
    const decision = check({ global: ASSUMED_TOKENS_PER_CALL + 1 }, { global: 2 });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.refusal.scope).toBe('global');
    expect(decision.refusal.message).toContain('No call was made');
  });

  it('reports the most restrictive scope, not the first one that failed', () => {
    // Global is checked first and is also over, but the request scope has less
    // room. Naming global would send someone to raise a ceiling that is not the
    // one stopping them.
    const decision = check({ global: 10_000, request: 9_000 }, { global: 9_500, request: 8_999 });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.refusal.scope).toBe('request');
  });

  it('says what is spent and what is allowed, in tokens', () => {
    const decision = check({ document: 1_000 }, { document: 900 });

    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.refusal).toMatchObject({ scope: 'document', limit: 1_000, spent: 900 });
  });

  it('treats a zero ceiling as "no calls at all"', () => {
    expect(check({ global: 0 }).allowed).toBe(false);
  });
});

describe('estimateCostMicroUsd', () => {
  const rates = { 'test-model': { inputPerMillionUsd: 3, outputPerMillionUsd: 15 } };

  it('costs input and output at their own rates', () => {
    // 1M input at $3 plus 1M output at $15 = $18 = 18,000,000 micro-USD.
    expect(
      estimateCostMicroUsd({
        usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
        model: 'test-model',
        rates,
      }),
    ).toBe(18_000_000);
  });

  it('returns whole micro-USD, so a ledger of them sums exactly', () => {
    const cost = estimateCostMicroUsd({
      usage: { inputTokens: 1_234, outputTokens: 567 },
      model: 'test-model',
      rates,
    });

    expect(Number.isInteger(cost)).toBe(true);
  });

  it('never costs an unpriced model at zero', () => {
    // Zero is the one answer that is certainly wrong and the one nobody would
    // question, so an unpriced model shows up as cost rather than as nothing.
    const cost = estimateCostMicroUsd({
      usage: { inputTokens: 100_000, outputTokens: 100_000 },
      model: 'a-model-nobody-priced',
      rates,
    });

    expect(cost).toBeGreaterThan(0);
    expect(cost).toBe(
      Math.round(
        (0.1 * FALLBACK_MODEL_RATE.inputPerMillionUsd +
          0.1 * FALLBACK_MODEL_RATE.outputPerMillionUsd) *
          1_000_000,
      ),
    );
  });
});
