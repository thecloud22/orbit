import { DEFAULT_MODEL_IDS, DEFAULT_MODELS } from '@orbit/model-provider';
import { FALLBACK_MODEL_RATE } from '@orbit/sop-generation';
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

  /**
   * The default model must be priced, on both providers.
   *
   * Without this the two defaults could drift away from the table and every
   * estimate would quietly fall to `FALLBACK_MODEL_RATE` — which is
   * deliberately conservative, so the failure would show up as a spend readout
   * that was three times too high rather than as anything that looked broken.
   * Changing a default now fails here until its rate is added.
   */
  it('prices every default model, on every family and invocation', () => {
    const rates = resolveModelRates({});

    // Iterated from the selection layer rather than listed here, so a new
    // family or a new default cannot be added without a rate: the list this
    // walks is the same one `resolveModelSelection` defaults from.
    expect(DEFAULT_MODEL_IDS.length).toBeGreaterThan(2);

    for (const model of DEFAULT_MODEL_IDS) {
      expect(rates[model], `no configured rate for the default model "${model}"`).toBeDefined();
      expect(rates[model]).not.toEqual(FALLBACK_MODEL_RATE);
    }
  });

  it('prices the same model the same way whichever way it is invoked', () => {
    // Switching from a direct call to Bedrock must not change what a draft
    // appears to cost. It is the same model either way; only the id differs.
    const rates = resolveModelRates({});

    expect(rates[DEFAULT_MODELS['anthropic:bedrock']]).toEqual(
      rates[DEFAULT_MODELS['anthropic:direct']],
    );
  });
});
