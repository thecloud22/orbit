import {
  checkModelBudget,
  estimateCostMicroUsd,
  type ModelBudgets,
  type ModelCallUsage,
  type ModelRates,
  type ModelSpend,
} from '@orbit/model-budget';
import type { DecisionJudge, JudgeRequest, JudgeResult, JudgeUsage } from '@orbit/runtime';

/**
 * The judge, assembled: budget check, model call, ledger write.
 *
 * Composition rather than a second abstraction. The three things a judged
 * decision needs at run time are already defined elsewhere — the cap in
 * @orbit/model-budget, the model boundary below, the ledger in @orbit/db — and
 * this puts them in the one order that is correct: **check, then call, then
 * record**. A cap checked after the call is not a cap, and a call recorded
 * before it returns would bill for tokens nobody spent.
 */

/** What the underlying model layer does, with no budget or ledger of its own. */
export interface DecisionModel {
  readonly provider: string;
  readonly model: string;
  /**
   * Asks the model to pick an index. Throws on a provider failure.
   *
   * Returns the raw answer without judging it: the runtime re-validates the
   * index independently, and a model layer that pre-filtered would make that
   * second check untestable.
   */
  decide(request: JudgeRequest): Promise<DecisionModelAnswer>;
}

export interface DecisionModelAnswer {
  readonly alternativeIndex: number;
  readonly confidence: number;
  readonly rationale?: string;
  readonly usage: ModelCallUsage | null;
}

/** Reads and writes the spend ledger. Implemented over `model_usage` by the entry point. */
export interface DecisionSpendLedger {
  /** Totals for the scopes a run can measure, summed over the ledger. */
  spend(context: JudgeRequest['context']): Promise<ModelSpend>;
  record(input: {
    readonly context: JudgeRequest['context'];
    readonly provider: string;
    readonly model: string;
    readonly usage: ModelCallUsage;
    readonly estimatedCostMicroUsd: number;
  }): Promise<void>;
}

export interface ModelDecisionJudgeOptions {
  readonly model: DecisionModel;
  readonly ledger: DecisionSpendLedger;
  readonly budgets: ModelBudgets;
  readonly rates: ModelRates;
  /** Injectable so a test can measure latency without a clock that moves. */
  readonly now?: () => number;
}

export function createModelDecisionJudge(options: ModelDecisionJudgeOptions): DecisionJudge {
  const now = options.now ?? (() => Date.now());

  return {
    async judge(request: JudgeRequest): Promise<JudgeResult> {
      const spend = await options.ledger.spend(request.context);
      const decision = checkModelBudget({ budgets: options.budgets, spend });

      if (!decision.allowed) {
        // Refused before the model layer is touched at all. The provider is
        // never constructed into a call, so there is nothing to bill.
        return {
          ok: false,
          reason: 'budget_exhausted',
          message: decision.refusal.message,
        };
      }

      const startedAt = now();
      let answer: DecisionModelAnswer;

      try {
        answer = await options.model.decide(request);
      } catch (error) {
        return {
          ok: false,
          reason: isTimeout(error) ? 'timed_out' : 'provider_failed',
          // Orbit-authored. A provider's own message can embed the prompt, and
          // the prompt is page content.
          message: isTimeout(error)
            ? `The judge did not answer within ${String(request.timeoutMs)}ms.`
            : 'The model provider could not produce a decision.',
        };
      }

      const latencyMs = now() - startedAt;
      const usage: JudgeUsage | undefined =
        answer.usage === null
          ? undefined
          : {
              provider: options.model.provider,
              model: options.model.model,
              inputTokens: answer.usage.inputTokens,
              outputTokens: answer.usage.outputTokens,
              estimatedCostMicroUsd: estimateCostMicroUsd({
                usage: answer.usage,
                model: options.model.model,
                rates: options.rates,
              }),
              latencyMs,
            };

      // Recorded whether or not the runtime goes on to accept the answer. A
      // call that was refused for low confidence still spent its tokens, and a
      // ledger that only recorded useful calls would under-report every cap.
      if (usage !== undefined && answer.usage !== null) {
        await options.ledger.record({
          context: request.context,
          provider: usage.provider,
          model: usage.model,
          usage: answer.usage,
          estimatedCostMicroUsd: usage.estimatedCostMicroUsd,
        });
      }

      return {
        ok: true,
        alternativeIndex: answer.alternativeIndex,
        confidence: answer.confidence,
        ...(answer.rationale === undefined ? {} : { rationale: answer.rationale }),
        ...(usage === undefined ? {} : { usage }),
      };
    },
  };
}

function isTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === 'TimeoutError' || error.name === 'AbortError';
}
