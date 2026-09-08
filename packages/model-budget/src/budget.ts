/**
 * Model budgets, and what a call is estimated to cost.
 *
 * Every scope is checked *before* a call is made rather than after it lands. A
 * cap enforced afterwards is not a cap: the tokens are already spent by the
 * time it fires, and the only thing it can do is report them.
 *
 * Orbit calls a model at two moments in a workflow's life, and they can measure
 * different things, so the scopes are the union of what each can answer rather
 * than one list that fits neither (ADR-029, ADR-032):
 *
 * **Drafting a SOP**, when neither an agent nor a run exists yet:
 *
 * - **global** — every call in the deployment. The overall pot.
 * - **document** — every call for one SOP document. A document is 1:1 with the
 *   agent it will become (`agentIdForDocument` derives that agent's id from the
 *   document id deterministically), so "per agent" before publication means
 *   "per document".
 * - **request** — one Generate request: the initial call plus its one repair.
 *
 * **Executing an agent**, when a published agent and a run both exist:
 *
 * - **global** — the same deployment-wide pot, shared with drafting.
 * - **agent** — every judged decision ever made by one agent, across all of its
 *   versions. Deliberately per agent rather than per agent version: a cap that
 *   reset on republish would be a cap anyone could clear by publishing.
 * - **run** — every judged decision within a single run, which is what stops a
 *   long or looping workflow spending without limit.
 *
 * A caller supplies budgets and spend for the scopes it is in a position to
 * measure. Nothing here reads the environment, opens a connection, or calls a
 * model: it takes the numbers it is given and answers one question.
 */

export const MODEL_BUDGET_SCOPES = ['global', 'document', 'request', 'agent', 'run'] as const;
export type ModelBudgetScope = (typeof MODEL_BUDGET_SCOPES)[number];

/** How a scope reads to someone who is not holding this file open. */
export const MODEL_BUDGET_SCOPE_LABELS: Readonly<Record<ModelBudgetScope, string>> = {
  global: 'the deployment-wide budget',
  document: 'this workflow’s budget',
  request: 'the budget for a single Generate',
  agent: 'this agent’s budget',
  run: 'the budget for a single run',
};

/**
 * Token ceilings per scope. A scope with no entry is uncapped.
 *
 * Counted in total tokens — input plus output — because that is the number a
 * person setting a ceiling actually has in mind, and splitting the two would
 * make the common case ("stop at a million") take two settings.
 */
export type ModelBudgets = Readonly<Partial<Record<ModelBudgetScope, number>>>;

/**
 * What has already been spent, per scope.
 *
 * Partial, because the two callers measure different things: drafting can
 * answer `global`, `document` and `request`, and a run can answer `global`,
 * `agent` and `run`. Neither is in a position to answer the other’s scopes, and
 * inventing a zero for a scope nobody measured is how a cap silently stops
 * being one. A limit declared for a scope with no measured spend is therefore
 * refused rather than waved through — see `checkModelBudget`.
 */
export type ModelSpend = Readonly<Partial<Record<ModelBudgetScope, number>>>;

/**
 * What one more call is assumed to cost before it is made.
 *
 * A call's real size is unknowable until it returns, so the check needs an
 * assumption, and this is it, stated once rather than guessed at each call
 * site. It is deliberately generous: a cap that is reached slightly early is a
 * budget doing its job, and one that is reached slightly late is a budget that
 * failed at the only thing it exists for.
 */
export const ASSUMED_TOKENS_PER_CALL = 8_000;

export interface BudgetRefusal {
  readonly scope: ModelBudgetScope;
  readonly limit: number;
  /** Null when this scope’s spend could not be measured, which is itself a refusal. */
  readonly spent: number | null;
  /** Plain language, addressed to whoever hit it. */
  readonly message: string;
}

export type BudgetDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly refusal: BudgetRefusal };

/**
 * Whether one more call may be made.
 *
 * Every scope is checked and the **most restrictive** one is reported — the one
 * with the least headroom left. Reporting the first scope that happened to fail
 * would tell someone to raise a ceiling that is not the one stopping them.
 */
export function checkModelBudget(input: {
  readonly budgets: ModelBudgets;
  readonly spend: ModelSpend;
  readonly assumedTokens?: number;
}): BudgetDecision {
  const assumed = input.assumedTokens ?? ASSUMED_TOKENS_PER_CALL;

  let worst: { readonly refusal: BudgetRefusal; readonly headroom: number } | null = null;

  for (const scope of MODEL_BUDGET_SCOPES) {
    const limit = input.budgets[scope];

    if (limit === undefined) {
      continue;
    }

    const spent = input.spend[scope];

    // A ceiling nobody can measure is not a ceiling. Refusing is the only
    // honest answer: treating the missing number as zero would report the
    // budget as satisfied on the strength of having no idea.
    if (spent === undefined) {
      return {
        allowed: false,
        refusal: {
          scope,
          limit,
          spent: null,
          message:
            `${MODEL_BUDGET_SCOPE_LABELS[scope]} is set to ${String(limit)} tokens, but how much ` +
            'has already been spent against it could not be determined, so no call was made.',
        },
      };
    }

    const headroom = limit - spent;

    if (headroom >= assumed) {
      continue;
    }

    if (worst === null || headroom < worst.headroom) {
      worst = {
        headroom,
        refusal: {
          scope,
          limit,
          spent,
          message:
            `This would exceed ${MODEL_BUDGET_SCOPE_LABELS[scope]}: ` +
            `${String(spent)} of ${String(limit)} tokens are already used, and a further call is ` +
            `assumed to need about ${String(assumed)}. No call was made.`,
        },
      };
    }
  }

  return worst === null ? { allowed: true } : { allowed: false, refusal: worst.refusal };
}

/** Tokens a provider reported for one call. */
export interface ModelCallUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** Dollars per million tokens, per model. An estimate, never a bill. */
export interface ModelRate {
  readonly inputPerMillionUsd: number;
  readonly outputPerMillionUsd: number;
}

export type ModelRates = Readonly<Record<string, ModelRate>>;

/**
 * The rate used when a model has none configured.
 *
 * Zero would report every unpriced call as free, which is the one answer that
 * is certainly wrong and the one a reader would not question. A conservative
 * non-zero default makes an unpriced model visible as cost rather than
 * invisible; the surfaces that show it already say the figure is an estimate.
 */
export const FALLBACK_MODEL_RATE: ModelRate = {
  inputPerMillionUsd: 3,
  outputPerMillionUsd: 15,
};

/**
 * An approximate cost, in millionths of a dollar.
 *
 * Integer micro-USD rather than a float: these are summed over a ledger, and
 * floating-point dollars stop adding up. The rates come from this deployment's
 * own configuration and are never fetched from anywhere — nothing here is
 * authoritative about what anything costs.
 */
export function estimateCostMicroUsd(input: {
  readonly usage: ModelCallUsage;
  readonly model: string;
  readonly rates: ModelRates;
}): number {
  const rate = input.rates[input.model] ?? FALLBACK_MODEL_RATE;

  const dollars =
    (input.usage.inputTokens / 1_000_000) * rate.inputPerMillionUsd +
    (input.usage.outputTokens / 1_000_000) * rate.outputPerMillionUsd;

  return Math.round(dollars * 1_000_000);
}

/** Micro-USD as a short string, always marked as approximate by its caller. */
export function formatMicroUsd(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(4)}`;
}
