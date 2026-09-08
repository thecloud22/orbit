import type { DecisionJudge, JudgeRequest, JudgeResult, JudgeUsage } from '../ports';

/**
 * A judge that never calls a model.
 *
 * Every test in the repository uses this. It exists for the same reason
 * `createFakeBrowser` does — the interpreter's handling of a judged decision
 * has to be testable without a network, a key, or a bill — but it carries an
 * extra obligation the browser fake does not: the interesting cases here are
 * the *wrong* answers, so this can produce every one of them on demand,
 * including answers no honest provider would ever return.
 */

export interface FakeJudgeOptions {
  /**
   * Which alternative to choose, by outcome name.
   *
   * By name rather than by index so a test reads as the business case it is
   * ("available") instead of as a position that silently means something else
   * when an alternative is inserted.
   */
  readonly choose?: string;
  /** Chooses by raw index, including one outside the declared range. */
  readonly chooseIndex?: number;
  readonly confidence?: number;
  readonly rationale?: string;
  /** Returns a typed refusal instead of an answer. */
  readonly refuseWith?: 'provider_failed' | 'timed_out' | 'out_of_set' | 'budget_exhausted';
  /** Throws instead of returning, standing in for a provider that fell over. */
  readonly throws?: boolean;
  /** Returns a value that is not a valid result at all, bypassing the type. */
  readonly malformed?: unknown;
  /**
   * Decides from the request, for a test that wants the judge to actually look.
   *
   * Used by the real-browser test, where the point is that live page text
   * reaches the judge through the ordinary executor. It is still deterministic
   * and still calls no model: what it proves is the path, not the judgement.
   */
  readonly decide?: (request: JudgeRequest) => number;
  readonly usage?: JudgeUsage;
}

export interface FakeJudge extends DecisionJudge {
  /** Every request the judge was given, in order. Empty proves it was never called. */
  readonly requests: readonly JudgeRequest[];
}

export const FAKE_JUDGE_USAGE: JudgeUsage = {
  provider: 'fake',
  model: 'fake-judge',
  inputTokens: 120,
  outputTokens: 12,
  estimatedCostMicroUsd: 540,
  latencyMs: 3,
};

export function createFakeJudge(options: FakeJudgeOptions = {}): FakeJudge {
  const requests: JudgeRequest[] = [];

  return {
    requests,

    async judge(request) {
      requests.push(request);

      if (options.throws === true) {
        throw new Error('the fake judge was told to fall over');
      }

      if (options.malformed !== undefined) {
        return options.malformed as JudgeResult;
      }

      const usage = options.usage ?? FAKE_JUDGE_USAGE;

      if (options.refuseWith !== undefined) {
        return {
          ok: false,
          reason: options.refuseWith,
          message: `the fake judge refused with ${options.refuseWith}`,
          usage,
        };
      }

      const index =
        options.decide?.(request) ??
        options.chooseIndex ??
        request.alternatives.findIndex((one) => one.outcome === options.choose);

      return {
        ok: true,
        alternativeIndex: index,
        confidence: options.confidence ?? 0.95,
        ...(options.rationale === undefined ? {} : { rationale: options.rationale }),
        usage,
      };
    },
  };
}

/** A judge that fails the test if it is ever asked anything. */
export function createNeverCalledJudge(): FakeJudge {
  const requests: JudgeRequest[] = [];

  return {
    requests,
    judge(request) {
      requests.push(request);
      return Promise.reject(new Error('the judge was called and should not have been'));
    },
  };
}
