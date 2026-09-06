import {
  AssistProviderError,
  type AssistProvider,
  type DriftRanking,
  type DriftRankingRequest,
  type SemanticCheckRequest,
  type SemanticCheckVerdict,
} from '../provider';

/**
 * A provider that makes no network call and does what a test says.
 *
 * Behind the `./testing` subpath so production code has no import path to it,
 * matching @orbit/sop-generation/testing.
 */
export interface FakeAssistProvider extends AssistProvider {
  readonly semanticRequests: readonly SemanticCheckRequest[];
  readonly driftRequests: readonly DriftRankingRequest[];
}

export interface FakeAssistProviderOptions {
  readonly semantic?: SemanticCheckVerdict | (() => never);
  readonly drift?: DriftRanking | (() => never);
  /** Makes both methods fail, standing in for an unreachable model. */
  readonly failWith?: string;
}

export function createFakeAssistProvider(
  options: FakeAssistProviderOptions = {},
): FakeAssistProvider {
  const semanticRequests: SemanticCheckRequest[] = [];
  const driftRequests: DriftRankingRequest[] = [];

  function guard(): void {
    if (options.failWith !== undefined) {
      throw new AssistProviderError(options.failWith);
    }
  }

  return {
    descriptor: { provider: 'fake', model: 'fake-assist' },

    get semanticRequests() {
      return semanticRequests;
    },

    get driftRequests() {
      return driftRequests;
    },

    checkSemanticMatch(request) {
      semanticRequests.push(request);

      try {
        guard();
      } catch (error) {
        return Promise.reject(error);
      }

      return Promise.resolve(
        typeof options.semantic === 'function'
          ? options.semantic()
          : (options.semantic ?? { plausible: true, reason: 'Looks like the right control.' }),
      );
    },

    rankDriftCandidates(request) {
      driftRequests.push(request);

      try {
        guard();
      } catch (error) {
        return Promise.reject(error);
      }

      return Promise.resolve(
        typeof options.drift === 'function'
          ? options.drift()
          : (options.drift ?? { bestIndex: 0, reason: 'The first candidate is the same control.' }),
      );
    },
  };
}
