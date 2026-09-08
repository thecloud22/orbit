import type { ModelRates } from '@orbit/model-budget';
import type { JudgeRequest } from '@orbit/runtime';
import { describe, expect, it } from 'vitest';

import { createModelDecisionJudge, type DecisionModel, type DecisionSpendLedger } from './judge';

/**
 * The judge's own composition: check, call, record.
 *
 * No test here calls a model. The model layer is a stub whose whole purpose is
 * to be observable — the load-bearing assertion in half of these is that it was
 * *not* invoked.
 */

const RATES: ModelRates = { 'stub-model': { inputPerMillionUsd: 3, outputPerMillionUsd: 15 } };

const REQUEST: JudgeRequest = {
  question: 'Is this title available?',
  alternatives: [
    { outcome: 'available', description: 'It can be borrowed now.', insufficientEvidence: false },
    { outcome: 'unavailable', description: 'It cannot.', insufficientEvidence: false },
    { outcome: 'unclear', description: 'The page does not say.', insufficientEvidence: true },
  ],
  sources: [{ label: 'status', text: 'Available' }],
  timeoutMs: 15_000,
  context: {
    runId: 'run_test' as JudgeRequest['context']['runId'],
    agentVersionId: 'agentv_test' as JudgeRequest['context']['agentVersionId'],
    agentId: 'agent_test',
    agentStepId: 'check_availability',
  },
};

function stubModel(
  behaviour: {
    readonly throws?: Error;
    readonly index?: number;
    readonly confidence?: number;
  } = {},
) {
  const calls: JudgeRequest[] = [];

  const model: DecisionModel = {
    provider: 'stub',
    model: 'stub-model',
    async decide(request) {
      calls.push(request);
      if (behaviour.throws !== undefined) {
        throw behaviour.throws;
      }
      return {
        alternativeIndex: behaviour.index ?? 0,
        confidence: behaviour.confidence ?? 0.9,
        rationale: 'the status region says Available',
        usage: { inputTokens: 400, outputTokens: 20 },
      };
    },
  };

  return { model, calls };
}

function stubLedger(spent: Record<string, number> = {}) {
  const recorded: unknown[] = [];

  const ledger: DecisionSpendLedger = {
    async spend() {
      return { global: 0, agent: 0, run: 0, ...spent };
    },
    async record(input) {
      recorded.push(input);
    },
  };

  return { ledger, recorded };
}

describe('the budget is checked before the model is called', () => {
  it('refuses without invoking the model at all', async () => {
    const { model, calls } = stubModel();
    const { ledger, recorded } = stubLedger({ run: 99_000 });

    const judge = createModelDecisionJudge({
      model,
      ledger,
      budgets: { run: 100_000 },
      rates: RATES,
    });

    const result = await judge.judge(REQUEST);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('budget_exhausted');

    // The whole claim: a cap enforced after the call is not a cap.
    expect(calls).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it('refuses a scope whose spend could not be measured, rather than assuming zero', async () => {
    const { model, calls } = stubModel();
    const ledger: DecisionSpendLedger = {
      async spend() {
        return { global: 0 }; // No `run` figure at all.
      },
      async record() {},
    };

    const judge = createModelDecisionJudge({
      model,
      ledger,
      budgets: { run: 100_000 },
      rates: RATES,
    });

    const result = await judge.judge(REQUEST);

    expect(result.ok === false && result.reason).toBe('budget_exhausted');
    expect(calls).toEqual([]);
  });

  it('allows the call when every scope has headroom', async () => {
    const { model, calls } = stubModel();
    const { ledger } = stubLedger();

    const judge = createModelDecisionJudge({
      model,
      ledger,
      budgets: { global: 1_000_000, agent: 500_000, run: 100_000 },
      rates: RATES,
    });

    const result = await judge.judge(REQUEST);

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe('the ledger records what was actually spent', () => {
  it('writes one row per call, with the estimated cost', async () => {
    const { model } = stubModel();
    const { ledger, recorded } = stubLedger();

    const judge = createModelDecisionJudge({
      model,
      ledger,
      budgets: {},
      rates: RATES,
      now: () => 0,
    });

    await judge.judge(REQUEST);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      provider: 'stub',
      model: 'stub-model',
      usage: { inputTokens: 400, outputTokens: 20 },
      // 400/1e6*3 + 20/1e6*15 dollars, in micro-USD.
      estimatedCostMicroUsd: 1500,
    });
  });

  it('records a call the runtime will go on to reject for low confidence', async () => {
    // The tokens were spent either way. A ledger that only recorded useful
    // answers would under-report every cap it enforces.
    const { model } = stubModel({ confidence: 0.1 });
    const { ledger, recorded } = stubLedger();

    const judge = createModelDecisionJudge({ model, ledger, budgets: {}, rates: RATES });
    const result = await judge.judge(REQUEST);

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.confidence).toBe(0.1);
    expect(recorded).toHaveLength(1);
  });
});

describe('a provider that fails', () => {
  it('reports a timeout distinguishably from any other failure', async () => {
    const timeout = new Error('aborted');
    timeout.name = 'AbortError';

    const { model } = stubModel({ throws: timeout });
    const { ledger } = stubLedger();

    const judge = createModelDecisionJudge({ model, ledger, budgets: {}, rates: RATES });
    const result = await judge.judge(REQUEST);

    expect(result.ok === false && result.reason).toBe('timed_out');
  });

  it('reports any other failure as a provider failure', async () => {
    const { model } = stubModel({ throws: new Error('500 from upstream') });
    const { ledger } = stubLedger();

    const judge = createModelDecisionJudge({ model, ledger, budgets: {}, rates: RATES });
    const result = await judge.judge(REQUEST);

    expect(result.ok === false && result.reason).toBe('provider_failed');
  });

  it('never leaks the provider message, which can embed the prompt', async () => {
    // The prompt is page content, so a provider message that echoes it would
    // put page content into an error that is persisted and displayed.
    const { model } = stubModel({
      throws: new Error('bad request: <page-content>SECRET</page-content>'),
    });
    const { ledger } = stubLedger();

    const judge = createModelDecisionJudge({ model, ledger, budgets: {}, rates: RATES });
    const result = await judge.judge(REQUEST);

    expect(result.ok === false && result.message).not.toContain('SECRET');
  });
});

describe('the judge passes the answer through without judging it', () => {
  it('returns an out-of-range index unchanged, leaving the runtime to refuse it', async () => {
    // Deliberate. If this layer filtered, the runtime's independent
    // re-validation would be untestable and would eventually be removed as
    // dead code — which is precisely the check that must not be removed.
    const { model } = stubModel({ index: 42 });
    const { ledger } = stubLedger();

    const judge = createModelDecisionJudge({ model, ledger, budgets: {}, rates: RATES });
    const result = await judge.judge(REQUEST);

    expect(result.ok === true && result.alternativeIndex).toBe(42);
  });
});
