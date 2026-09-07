import { FALLBACK_MODEL_RATE, type ModelBudgets, type ModelRates } from '@orbit/sop-generation';

/**
 * Model budgets and price estimates, read from the environment.
 *
 * Library code never reads the environment; only entry points do. This mirrors
 * `env.ts` beside it, and an already-exported variable always wins so CI can
 * supply its own.
 *
 * Every ceiling is optional and every one defaults to *set*, not to unlimited.
 * A deployment that configures nothing still has a bound on what it can spend,
 * because the failure mode of the other default is an unbounded bill nobody
 * chose. Raising a ceiling is one variable; discovering an unbounded one is a
 * postmortem.
 */

/** Total tokens — input plus output — allowed across every call in this deployment. */
export const DEFAULT_GLOBAL_TOKEN_BUDGET = 5_000_000;

/** Total tokens allowed for one SOP document, across every draft it takes. */
export const DEFAULT_DOCUMENT_TOKEN_BUDGET = 500_000;

/** Total tokens allowed for one Generate: the attempt plus its one repair. */
export const DEFAULT_REQUEST_TOKEN_BUDGET = 100_000;

export const GLOBAL_BUDGET_ENV_VAR = 'ORBIT_LLM_TOKEN_BUDGET_GLOBAL';
export const DOCUMENT_BUDGET_ENV_VAR = 'ORBIT_LLM_TOKEN_BUDGET_PER_AGENT';
export const REQUEST_BUDGET_ENV_VAR = 'ORBIT_LLM_TOKEN_BUDGET_PER_RUN';

/**
 * Reads one ceiling.
 *
 * `unlimited` is spelled out rather than expressed as a blank or a zero,
 * because both of those are things someone types by accident. Anything else
 * unparseable is a configuration error and throws: booting with a ceiling
 * somebody meant to set and mistyped is the case this must not allow.
 */
export function readTokenBudget(
  name: string,
  fallback: number,
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  const raw = env[name];

  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const value = raw.trim();

  if (value.toLowerCase() === 'unlimited') {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `${name} must be a non-negative whole number of tokens, or "unlimited". Got "${value}".`,
    );
  }

  return parsed;
}

export function resolveModelBudgets(env: NodeJS.ProcessEnv = process.env): ModelBudgets {
  const global = readTokenBudget(GLOBAL_BUDGET_ENV_VAR, DEFAULT_GLOBAL_TOKEN_BUDGET, env);
  const document = readTokenBudget(DOCUMENT_BUDGET_ENV_VAR, DEFAULT_DOCUMENT_TOKEN_BUDGET, env);
  const request = readTokenBudget(REQUEST_BUDGET_ENV_VAR, DEFAULT_REQUEST_TOKEN_BUDGET, env);

  return {
    ...(global === undefined ? {} : { global }),
    ...(document === undefined ? {} : { document }),
    ...(request === undefined ? {} : { request }),
  };
}

/**
 * Per-model rates for the cost estimate, in USD per million tokens.
 *
 * Held here rather than fetched. Nothing in Orbit knows what a model actually
 * costs, and pretending otherwise by calling a price list would turn an
 * estimate into something that looks like a bill. Every surface that shows a
 * figure derived from these says it is approximate.
 */
export const DEFAULT_MODEL_RATES: ModelRates = {
  'claude-sonnet-5': { inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
  'claude-opus-5': { inputPerMillionUsd: 15, outputPerMillionUsd: 75 },
  'claude-haiku-4-5': { inputPerMillionUsd: 1, outputPerMillionUsd: 5 },
};

export const MODEL_RATES_ENV_VAR = 'ORBIT_LLM_RATES_USD_PER_MTOK';

/**
 * Optional per-model overrides, as `model=input:output` pairs.
 *
 * For example `claude-sonnet-5=3:15,my-model=0.5:2`. A model with no entry
 * here and none in the defaults is costed at `FALLBACK_MODEL_RATE`, which is
 * deliberately not zero: an unpriced model must show up as cost rather than as
 * nothing.
 */
export function resolveModelRates(env: NodeJS.ProcessEnv = process.env): ModelRates {
  const raw = env[MODEL_RATES_ENV_VAR];

  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_MODEL_RATES;
  }

  const rates: Record<string, { inputPerMillionUsd: number; outputPerMillionUsd: number }> = {
    ...DEFAULT_MODEL_RATES,
  };

  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();

    if (trimmed === '') {
      continue;
    }

    const match = /^([^=]+)=([0-9]*\.?[0-9]+):([0-9]*\.?[0-9]+)$/.exec(trimmed);

    if (match === null) {
      throw new Error(
        `${MODEL_RATES_ENV_VAR} entries must read "model=input:output" in USD per million tokens. Got "${trimmed}".`,
      );
    }

    rates[match[1]!.trim()] = {
      inputPerMillionUsd: Number(match[2]),
      outputPerMillionUsd: Number(match[3]),
    };
  }

  return rates;
}

export { FALLBACK_MODEL_RATE };
