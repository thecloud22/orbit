import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GLOBAL_TOKEN_BUDGET,
  DEFAULT_MODEL_RATES,
  GLOBAL_BUDGET_ENV_VAR,
  MODEL_RATES_ENV_VAR,
  readTokenBudget,
  resolveModelBudgets,
  resolveModelRates,
} from './model-budget-env';

/**
 * Reading budgets from the environment.
 *
 * The claim worth testing is the default: a deployment that configures nothing
 * still has a ceiling. The other failure mode a cap must not have is booting
 * quietly with a ceiling somebody meant to set and mistyped, so anything
 * unparseable throws rather than falling back.
 */
describe('resolveModelBudgets', () => {
  it('caps a deployment that has configured nothing', () => {
    const budgets = resolveModelBudgets({});

    expect(budgets.global).toBe(DEFAULT_GLOBAL_TOKEN_BUDGET);
    expect(budgets.document).toBeGreaterThan(0);
    expect(budgets.request).toBeGreaterThan(0);
  });

  it('takes a configured ceiling over the default', () => {
    expect(resolveModelBudgets({ [GLOBAL_BUDGET_ENV_VAR]: '1234' }).global).toBe(1234);
  });

  it('accepts "unlimited" as the deliberate way to remove a ceiling', () => {
    // Spelled out rather than expressed as a blank or a zero, both of which are
    // things somebody types by accident.
    expect(resolveModelBudgets({ [GLOBAL_BUDGET_ENV_VAR]: 'unlimited' }).global).toBeUndefined();
  });

  it('refuses to boot on a ceiling it cannot read', () => {
    expect(() =>
      readTokenBudget(GLOBAL_BUDGET_ENV_VAR, 10, { [GLOBAL_BUDGET_ENV_VAR]: 'lots' }),
    ).toThrow(/must be a non-negative whole number/);
    expect(() =>
      readTokenBudget(GLOBAL_BUDGET_ENV_VAR, 10, { [GLOBAL_BUDGET_ENV_VAR]: '-5' }),
    ).toThrow();
    expect(() =>
      readTokenBudget(GLOBAL_BUDGET_ENV_VAR, 10, { [GLOBAL_BUDGET_ENV_VAR]: '1.5' }),
    ).toThrow();
  });

  it('treats an empty value as unset, not as zero', () => {
    expect(readTokenBudget(GLOBAL_BUDGET_ENV_VAR, 42, { [GLOBAL_BUDGET_ENV_VAR]: '   ' })).toBe(42);
  });
});

describe('resolveModelRates', () => {
  it('ships rates for the models Orbit actually configures', () => {
    expect(resolveModelRates({})).toEqual(DEFAULT_MODEL_RATES);
  });

  it('overrides one model without discarding the rest', () => {
    const rates = resolveModelRates({ [MODEL_RATES_ENV_VAR]: 'my-model=0.5:2' });

    expect(rates['my-model']).toEqual({ inputPerMillionUsd: 0.5, outputPerMillionUsd: 2 });
    expect(rates['claude-sonnet-5']).toEqual(DEFAULT_MODEL_RATES['claude-sonnet-5']);
  });

  it('refuses a malformed rate rather than silently costing at nothing', () => {
    expect(() => resolveModelRates({ [MODEL_RATES_ENV_VAR]: 'my-model=free' })).toThrow(
      /model=input:output/,
    );
  });
});
