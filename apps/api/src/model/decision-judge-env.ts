import { newModelRequestId, type AgentVersionId, type RunId } from '@orbit/contracts';
import {
  createChatDecisionModel,
  createModelDecisionJudge,
  type DecisionSpendLedger,
} from '@orbit/decision-judge';
import type { OrbitDatabase } from '@orbit/db';
import { createRepositories } from '@orbit/db';
import { DEFAULT_MODEL_RATES, type ModelBudgets } from '@orbit/model-budget';
import { resolveModelSelection } from '@orbit/model-provider';
import type { DecisionJudge } from '@orbit/runtime';

/**
 * The judge a real run uses, or none at all.
 *
 * ADR-032 shipped judged decisions and every entry point that executes an agent
 * left this port empty, so a published workflow containing one halted with
 * `DECISION_JUDGE_UNAVAILABLE` the first time it reached the step. The
 * capability existed and was unreachable — the same shape of gap the binding
 * resolver had until a composition root supplied one.
 *
 * Returning `undefined` rather than a judge that refuses is deliberate. A
 * deployment with no model configured has not *failed* to build a judge; it has
 * declined to permit one, and the runtime already has the right words for what
 * happens next. A judge that always answered "provider failed" would report a
 * misconfiguration as a model outage.
 */
export function createRunDecisionJudge(options: {
  readonly database: OrbitDatabase;
  readonly budgets: ModelBudgets;
}): DecisionJudge | undefined {
  // Its own model variable, which `resolveModelSelection` already anticipated:
  // a decision runs on every execution and may deserve a cheaper model than
  // drafting, which runs once per workflow.
  const resolution = resolveModelSelection(process.env, {
    ...(process.env['ORBIT_LLM_DECISION_MODEL'] === undefined
      ? {}
      : { modelOverride: process.env['ORBIT_LLM_DECISION_MODEL'] }),
  });

  if (resolution.status !== 'configured') {
    return undefined;
  }

  return createModelDecisionJudge({
    model: createChatDecisionModel(resolution.selection),
    ledger: createDatabaseSpendLedger(options.database),
    budgets: options.budgets,
    rates: DEFAULT_MODEL_RATES,
  });
}

/**
 * The spend ledger, over the `model_usage` table Watchtower already reports.
 *
 * One table, so the budget a run is checked against and the usage a person
 * reads in Admin are the same numbers. A separate counter would drift, and the
 * first anyone would know is a run refused against a budget the screen said was
 * untouched.
 *
 * `document` and `request` are absent from the spend it reports, because a run
 * cannot measure them: a run knows its agent version, not the document that
 * version was compiled from, and "one Generate" is a drafting concept with no
 * meaning here. An unmeasurable scope is left unset rather than reported as
 * zero — zero would read as "nothing spent" and quietly disable a ceiling
 * somebody set.
 */
export function createDatabaseSpendLedger(database: OrbitDatabase): DecisionSpendLedger {
  const repositories = createRepositories(database);

  return {
    async spend(context) {
      const [global, run] = await Promise.all([
        repositories.modelUsage.totals(),
        repositories.modelUsage.totalsForRun(context.runId as RunId),
      ]);

      return {
        global: global.totalTokens,
        run: run.totalTokens,
      };
    },

    async record(input) {
      await repositories.modelUsage.record({
        requestId: newModelRequestId(),
        runId: input.context.runId as RunId,
        agentVersionId: input.context.agentVersionId as AgentVersionId,
        provider: input.provider,
        model: input.model,
        inputTokens: input.usage.inputTokens,
        outputTokens: input.usage.outputTokens,
        estimatedCostMicroUsd: input.estimatedCostMicroUsd,
        attempt: 1,
      });
    },
  };
}
