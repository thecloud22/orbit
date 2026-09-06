import type { SopGraphIssue } from '@orbit/sop-graph';

/**
 * The model boundary.
 *
 * A provider does one thing: turn source text into whatever the model produced.
 * It does not validate that output and it does not persist it — those are the
 * pipeline's job, and keeping them out of here is what lets an invalid proposal
 * reach the validator as data instead of surfacing as a provider failure.
 *
 * Failure travels by exception rather than by a second return channel. One
 * condition with two ways to express it invites a caller to handle one and
 * forget the other; `SopProviderError` is the only way a provider reports that
 * it could not produce anything at all.
 */

export class SopProviderError extends Error {
  readonly provider: string;

  constructor(message: string, options?: { readonly provider?: string; readonly cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'SopProviderError';
    this.provider = options?.provider ?? 'unknown';
  }
}

export function isSopProviderError(error: unknown): error is SopProviderError {
  return error instanceof SopProviderError;
}

/**
 * What a repair attempt is told.
 *
 * `previousAttempt` is the assembled document that was actually validated, not
 * the model's untouched reply: the issue paths below index into that document,
 * so handing back anything else would make them point at the wrong thing.
 */
export interface SopRepairContext {
  readonly previousAttempt: unknown;
  readonly issues: readonly SopGraphIssue[];
}

export interface SopGraphProposalRequest {
  readonly sourceText: string;
  readonly repairContext?: SopRepairContext;
}

export interface ProviderDescriptor {
  readonly provider: string;
  readonly model: string;
}

export interface LLMProvider {
  readonly descriptor: ProviderDescriptor;
  /** Returns the model's structured output, unvalidated. Throws SopProviderError. */
  generateSopGraphProposal(request: SopGraphProposalRequest): Promise<unknown>;
}

/**
 * A provider for a deployment that has no model configured.
 *
 * This is a null object, not a test double: it belongs to production precisely
 * so a missing API key is a clear failure on the one route that needs a model,
 * rather than a process that refuses to boot and takes every unrelated route
 * down with it.
 */
export function createUnconfiguredSopProvider(reason: string): LLMProvider {
  return {
    descriptor: { provider: 'unconfigured', model: 'none' },
    generateSopGraphProposal() {
      return Promise.reject(new SopProviderError(reason, { provider: 'unconfigured' }));
    },
  };
}
