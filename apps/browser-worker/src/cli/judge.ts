import type { AgentId } from '@orbit/contracts';
import type { OrbitRepositories } from '@orbit/db';
import {
  createChatDecisionModel,
  createModelDecisionJudge,
  type DecisionSpendLedger,
} from '@orbit/decision-judge';
import { noticeDeprecations, resolveModelSelection } from '@orbit/model-provider';
import {
  parseModelRates,
  parseTokenBudget,
  type ModelBudgets,
  type ModelRates,
} from '@orbit/model-budget';
import type { DecisionJudge, DecisionSettings, JudgeRequest } from '@orbit/runtime';

/**
 * Where the judge is wired to the runtime.
 *
 * This is the composition root, and the only place in the repository where a
 * model provider and the execution runtime are in the same file. @orbit/runtime
 * declares `DecisionJudge` and imports nothing from @orbit/decision-judge — the
 * same arrangement it has with `BrowserExecutor` and
 * @orbit/executor-playwright, and `decision-judge-boundary.test.ts` is what
 * keeps it true.
 *
 * A deployment with no key configured gets no judge at all rather than a broken
 * one. Every `0.1` agent then runs exactly as before, and an agent that
 * contains a judged decision halts with `DECISION_JUDGE_UNAVAILABLE` — which
 * says what is wrong, unlike a provider error three steps in.
 */

export const DECISION_MODEL_ENV_VAR = 'ORBIT_LLM_DECISION_MODEL';
export const DECISION_CONFIDENCE_ENV_VAR = 'ORBIT_LLM_DECISION_CONFIDENCE_MIN';
export const AGENT_BUDGET_ENV_VAR = 'ORBIT_LLM_TOKEN_BUDGET_PER_AGENT_RUNTIME';
export const RUN_BUDGET_ENV_VAR = 'ORBIT_LLM_TOKEN_BUDGET_PER_RUN_EXECUTION';

/** Total tokens one agent may spend on judged decisions, across all its versions. */
export const DEFAULT_AGENT_DECISION_TOKEN_BUDGET = 1_000_000;

/** Total tokens one run may spend on judged decisions. */
export const DEFAULT_RUN_DECISION_TOKEN_BUDGET = 50_000;

/**
 * The bar an answer must clear when a step declares none.
 *
 * Conservative, and defaulting to *set* rather than to unlimited for the same
 * reason every token ceiling does: the failure mode of the permissive default
 * is a confident wrong branch that nothing reports.
 */
export const DEFAULT_DECISION_CONFIDENCE_MIN = 0.8;

export const GLOBAL_BUDGET_ENV_VAR = 'ORBIT_LLM_TOKEN_BUDGET_GLOBAL';
export const MODEL_RATES_ENV_VAR = 'ORBIT_LLM_RATES_USD_PER_MTOK';

/** The same deployment-wide pot drafting spends from; the same variable names it. */
export const DEFAULT_GLOBAL_TOKEN_BUDGET = 5_000_000;

export function resolveGlobalBudget(env: NodeJS.ProcessEnv = process.env): number | undefined {
  return parseTokenBudget(
    env[GLOBAL_BUDGET_ENV_VAR],
    DEFAULT_GLOBAL_TOKEN_BUDGET,
    GLOBAL_BUDGET_ENV_VAR,
  );
}

export function resolveJudgeModelRates(env: NodeJS.ProcessEnv = process.env): ModelRates {
  return parseModelRates(env[MODEL_RATES_ENV_VAR], MODEL_RATES_ENV_VAR);
}

function readConfidence(env: NodeJS.ProcessEnv): number {
  const raw = env[DECISION_CONFIDENCE_ENV_VAR];

  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_DECISION_CONFIDENCE_MIN;
  }

  const value = Number(raw.trim());

  // Throws rather than falling back. Booting with a threshold somebody meant to
  // set and mistyped is the one case this must not allow: it would silently
  // lower the bar on every judged decision in the deployment.
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(
      `${DECISION_CONFIDENCE_ENV_VAR} must be a number between 0 and 1. Got "${raw.trim()}".`,
    );
  }

  return value;
}

export function resolveDecisionSettings(env: NodeJS.ProcessEnv = process.env): DecisionSettings {
  return { defaultConfidenceThreshold: readConfidence(env) };
}

/**
 * The budgets a *run* can measure.
 *
 * Only the three scopes an execution is in a position to answer are declared.
 * A ceiling nobody can measure is refused by `checkModelBudget` rather than
 * waved through, so declaring `document` here would halt every judged decision
 * in the deployment.
 */
export function resolveExecutionBudgets(
  globalBudget: number | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ModelBudgets {
  const agent = parseTokenBudget(
    env[AGENT_BUDGET_ENV_VAR],
    DEFAULT_AGENT_DECISION_TOKEN_BUDGET,
    AGENT_BUDGET_ENV_VAR,
  );
  const run = parseTokenBudget(
    env[RUN_BUDGET_ENV_VAR],
    DEFAULT_RUN_DECISION_TOKEN_BUDGET,
    RUN_BUDGET_ENV_VAR,
  );

  return {
    ...(globalBudget === undefined ? {} : { global: globalBudget }),
    ...(agent === undefined ? {} : { agent }),
    ...(run === undefined ? {} : { run }),
  };
}

/**
 * The ledger, over the same `model_usage` table drafting writes to.
 *
 * One ledger, not two. Every scope is a `SUM` over the append-only rows, so the
 * number a cap is enforced against and the number a person is shown come from
 * the same place and cannot drift apart.
 */
export function createLedger(repositories: OrbitRepositories): DecisionSpendLedger {
  return {
    async spend(context: JudgeRequest['context']) {
      const [global, agent, run] = await Promise.all([
        repositories.modelUsage.totals(),
        repositories.modelUsage.totalsForAgent(context.agentId as AgentId),
        repositories.modelUsage.totalsForRun(context.runId),
      ]);

      return {
        global: global.totalTokens,
        agent: agent.totalTokens,
        run: run.totalTokens,
      };
    },

    async record(input: Parameters<DecisionSpendLedger['record']>[0]) {
      await repositories.modelUsage.record({
        // A judged decision is one call with no repair, so the request id is
        // the run's own decision and `attempt` is always 1.
        requestId: `mreq_${input.context.runId}_${input.context.agentStepId}` as Parameters<
          typeof repositories.modelUsage.record
        >[0]['requestId'],
        runId: input.context.runId,
        agentVersionId: input.context.agentVersionId,
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

export interface JudgeWiringOptions {
  readonly repositories: OrbitRepositories;
  readonly rates: ModelRates;
  readonly globalBudget: number | undefined;
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * The judge, or undefined when this deployment has configured no model.
 *
 * The selection — which family, reached how, with which credential — is
 * @orbit/model-provider's, resolved from the same variables the API and the
 * recorder read (ADR-034). What stays here is the judge's own override: a
 * decision runs on every execution, so a deployment may want a different cost
 * profile for it than for drafting, and `ORBIT_LLM_DECISION_MODEL` is that.
 *
 * A mistyped or impossible configuration throws out of here rather than
 * returning undefined. Silently running with no judge because `LLM_PROVIDER`
 * was misspelled would turn a typo into every judged agent halting, with
 * nothing saying why.
 */
export function createJudge(options: JudgeWiringOptions): DecisionJudge | undefined {
  const env = options.env ?? process.env;
  const configuredModel = env[DECISION_MODEL_ENV_VAR]?.trim();

  const resolution = resolveModelSelection(
    env,
    configuredModel === undefined || configuredModel === ''
      ? {}
      : { modelOverride: configuredModel },
  );

  noticeDeprecations(resolution.deprecations);

  if (resolution.status === 'unconfigured') {
    return undefined;
  }

  return createModelDecisionJudge({
    model: createChatDecisionModel(resolution.selection),
    ledger: createLedger(options.repositories),
    budgets: resolveExecutionBudgets(options.globalBudget, env),
    rates: options.rates,
  });
}
