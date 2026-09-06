import type { ElementFingerprint, SelectorChain } from '@orbit/execution-mapping';

/**
 * The model boundary for advisory assists.
 *
 * Same discipline as @orbit/sop-generation: one interface, failure by
 * exception rather than a second return channel, and exactly one file in the
 * package that touches a model client.
 *
 * The difference from Task 2 is what happens when it fails. A generation
 * failure there meant no draft; here it means no *advice*, and advice is
 * optional by definition. Nothing this provider does can block a recording, so
 * every caller treats an error as "no suggestion available" rather than as a
 * problem to surface as a failure.
 */

export class AssistProviderError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AssistProviderError';
  }
}

export interface SemanticCheckRequest {
  /** What the SOP step says it does, in the author's words. */
  readonly stepPurpose: string;
  readonly stepKind: string;
  readonly fingerprint: ElementFingerprint;
  readonly selectors: SelectorChain;
}

export interface SemanticCheckVerdict {
  /** False when the element looks unrelated to what the step describes. */
  readonly plausible: boolean;
  readonly reason: string;
}

export interface DriftRankingRequest {
  readonly stepPurpose: string;
  readonly expected: ElementFingerprint;
  readonly candidates: readonly {
    readonly index: number;
    readonly fingerprint: ElementFingerprint;
  }[];
}

export interface DriftRanking {
  /** Index of the best candidate, or null when none is plausible. */
  readonly bestIndex: number | null;
  readonly reason: string;
}

export interface AssistProvider {
  readonly descriptor: { readonly provider: string; readonly model: string };
  checkSemanticMatch(request: SemanticCheckRequest): Promise<SemanticCheckVerdict>;
  rankDriftCandidates(request: DriftRankingRequest): Promise<DriftRanking>;
}

/**
 * A provider for a deployment with no model configured.
 *
 * A null object, not a test double. Advice is optional, so the absence of a
 * model must degrade the recorder to "no suggestions" rather than break it.
 */
export function createUnconfiguredAssistProvider(reason: string): AssistProvider {
  return {
    descriptor: { provider: 'unconfigured', model: 'none' },
    checkSemanticMatch() {
      return Promise.reject(new AssistProviderError(reason));
    },
    rankDriftCandidates() {
      return Promise.reject(new AssistProviderError(reason));
    },
  };
}
