import { FALLBACK_MODEL_RATE, type ModelRates } from './budget';

/**
 * Per-model rates and the parsers for the two things a deployment configures.
 *
 * The table lives here rather than in an entry point because there are now two
 * entry points that need it — the API drafts SOPs, the browser worker judges
 * decisions — and two copies of a price table is how one deployment reports two
 * different estimates for the same spend.
 *
 * **Nothing here reads `process.env`.** Library code takes configuration and
 * entry points read environments, exactly as `createSopProvider` does. These
 * are pure functions over strings an entry point has already fetched, which is
 * also what lets every branch be tested by passing a value rather than by
 * mutating a global.
 *
 * Rates are held, never fetched. Calling a price list would turn an estimate
 * into something that looks like a bill, and every surface showing a figure
 * derived from these says it is approximate.
 */

export const DEFAULT_MODEL_RATES: ModelRates = {
  'claude-sonnet-5': { inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
  'claude-opus-5': { inputPerMillionUsd: 15, outputPerMillionUsd: 75 },
  'claude-haiku-4-5': { inputPerMillionUsd: 1, outputPerMillionUsd: 5 },

  /**
   * The same models under their Bedrock ids.
   *
   * A rate table is keyed by `descriptor.model`, and Bedrock reports a
   * different string for the same model — so without these rows every Bedrock
   * call would silently fall to `FALLBACK_MODEL_RATE` and a deployment would
   * read one estimate before switching provider and a different one after,
   * having changed nothing about what it spends.
   *
   * The numbers are the first-party Anthropic rates, which is an approximation
   * and is stated as one: Bedrock is partner-operated and prices separately. A
   * cross-region inference profile (`us.anthropic.…`) needs its own entry,
   * because the id is the key.
   */
  'anthropic.claude-haiku-4-5': { inputPerMillionUsd: 1, outputPerMillionUsd: 5 },
  'anthropic.claude-sonnet-5': { inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
  'anthropic.claude-opus-5': { inputPerMillionUsd: 15, outputPerMillionUsd: 75 },

  /**
   * Google's models, reached directly (ADR-034).
   *
   * There are no Bedrock rows for these and there never will be: Bedrock does
   * not serve Gemini, and `resolveModelSelection` refuses that combination
   * before anything gets far enough to need a rate.
   *
   * The figures are Google's published list prices for standard-context
   * prompts. Like the Claude rows they are held rather than fetched, and like
   * every figure derived from this table they are labelled an estimate
   * everywhere they are shown — a long prompt on some tiers is priced
   * differently, and this table does not model that.
   */
  'gemini-2.5-flash-lite': { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 },
  'gemini-2.5-flash': { inputPerMillionUsd: 0.3, outputPerMillionUsd: 2.5 },
  'gemini-2.5-pro': { inputPerMillionUsd: 1.25, outputPerMillionUsd: 10 },
};

/**
 * Parses `model=input:output` pairs, e.g. `claude-sonnet-5=3:15,my-model=0.5:2`.
 *
 * A model with no entry here and none in the defaults is costed at
 * `FALLBACK_MODEL_RATE`, which is deliberately not zero: an unpriced model must
 * show up as cost rather than as nothing.
 */
export function parseModelRates(raw: string | undefined, variableName: string): ModelRates {
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
        `${variableName} entries must read "model=input:output" in USD per million tokens. Got "${trimmed}".`,
      );
    }

    rates[match[1]!.trim()] = {
      inputPerMillionUsd: Number(match[2]),
      outputPerMillionUsd: Number(match[3]),
    };
  }

  return rates;
}

/**
 * Parses one token ceiling.
 *
 * `unlimited` is spelled out rather than expressed as a blank or a zero,
 * because both of those are things someone types by accident. Anything else
 * unparseable throws: booting with a ceiling somebody meant to set and mistyped
 * is the case this must not allow.
 */
export function parseTokenBudget(
  raw: string | undefined,
  fallback: number,
  variableName: string,
): number | undefined {
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
      `${variableName} must be a non-negative whole number of tokens, or "unlimited". Got "${value}".`,
    );
  }

  return parsed;
}

export { FALLBACK_MODEL_RATE };
