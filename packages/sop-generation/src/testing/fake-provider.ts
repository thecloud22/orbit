import type { ModelCallUsage } from '@orbit/model-budget';
import type {
  LLMProvider,
  ProviderDescriptor,
  RuleDraftingRequest,
  RuleProposalResponse,
  SopGraphProposalRequest,
  SopGraphProposalResponse,
} from '../provider';
import { SopProviderError } from '../provider';

/**
 * A provider that makes no network call and does exactly what a test says.
 *
 * It lives behind `@orbit/sop-generation/testing` so production code has no
 * import path to it at all — the same reason `@orbit/db/testing` keeps the
 * destructive reset helpers out of the package root.
 *
 * Every request it receives is recorded, because the interesting assertion in
 * this package is not only what came back but what was *asked*: a repair must
 * carry the real validation issues from the failed attempt, and the only way to
 * prove that is to look at the second request.
 */

export type FakeProviderResponse =
  | { readonly kind: 'respond'; readonly raw: unknown; readonly usage?: ModelCallUsage | null }
  | { readonly kind: 'throw'; readonly message: string };

/**
 * `usage` defaults to a small, fixed, non-zero pair.
 *
 * Not zero: a test that never touches usage should still exercise the ledger
 * writing something, so that "no usage was recorded" is a failure the existing
 * tests can catch rather than the silent default.
 */
export const FAKE_CALL_USAGE: ModelCallUsage = { inputTokens: 1_000, outputTokens: 500 };

export function respondWith(raw: unknown, usage?: ModelCallUsage | null): FakeProviderResponse {
  return usage === undefined ? { kind: 'respond', raw } : { kind: 'respond', raw, usage };
}

export function failWith(message: string): FakeProviderResponse {
  return { kind: 'throw', message };
}

export interface FakeSopProvider extends LLMProvider {
  /** Every request, in order. A repair is `requests[1]`. */
  readonly requests: readonly SopGraphProposalRequest[];
  readonly callCount: number;
  /** Every rule-drafting request, in order, kept separately from generation. */
  readonly ruleRequests: readonly RuleDraftingRequest[];
}

export interface FakeSopProviderOptions {
  /**
   * Decides each response from the request and how many have come before, so
   * one mechanism covers both an ordered script and a provider that reacts to
   * its input.
   */
  readonly respond: (request: SopGraphProposalRequest, callIndex: number) => FakeProviderResponse;
  readonly descriptor?: ProviderDescriptor;
  /**
   * How to answer a rule-drafting call. Optional, because most tests here are
   * about generation and a fake that demanded a rule script would make every
   * one of them say something about a feature they do not use.
   */
  readonly respondToRule?: (
    request: RuleDraftingRequest,
    callIndex: number,
  ) => FakeProviderResponse;
}

/** Turns an ordered list into a `respond` function; extra calls fail loudly. */
export function respondInOrder(
  responses: readonly FakeProviderResponse[],
): (request: SopGraphProposalRequest, callIndex: number) => FakeProviderResponse {
  return (_request, callIndex) => {
    const response = responses[callIndex];

    if (response === undefined) {
      throw new Error(
        `The fake provider was called ${callIndex + 1} times but only ${responses.length} response(s) were scripted.`,
      );
    }

    return response;
  };
}

export function createFakeSopProvider(options: FakeSopProviderOptions): FakeSopProvider {
  const requests: SopGraphProposalRequest[] = [];
  const ruleRequests: RuleDraftingRequest[] = [];

  return {
    descriptor: options.descriptor ?? { provider: 'fake', model: 'fake-model' },

    get requests() {
      return requests;
    },

    get callCount() {
      return requests.length;
    },

    get ruleRequests() {
      return ruleRequests;
    },

    draftRuleDecision(request: RuleDraftingRequest): Promise<RuleProposalResponse> {
      const callIndex = ruleRequests.length;
      ruleRequests.push(request);

      if (options.respondToRule === undefined) {
        return Promise.reject(
          new SopProviderError('This fake provider was not scripted to draft a rule.', {
            provider: 'fake',
          }),
        );
      }

      const response = options.respondToRule(request, callIndex);

      return response.kind === 'throw'
        ? Promise.reject(new SopProviderError(response.message, { provider: 'fake' }))
        : Promise.resolve({
            proposal: response.raw,
            usage: response.usage === undefined ? FAKE_CALL_USAGE : response.usage,
          });
    },

    generateSopGraphProposal(request: SopGraphProposalRequest): Promise<SopGraphProposalResponse> {
      const callIndex = requests.length;
      requests.push(request);

      const response = options.respond(request, callIndex);

      return response.kind === 'throw'
        ? Promise.reject(new SopProviderError(response.message, { provider: 'fake' }))
        : Promise.resolve({
            proposal: response.raw,
            usage: response.usage === undefined ? FAKE_CALL_USAGE : response.usage,
          });
    },
  };
}
