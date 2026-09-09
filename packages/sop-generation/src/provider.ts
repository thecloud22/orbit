import type { SopGraphIssue } from '@orbit/sop-graph';

import type { ModelCallUsage } from '@orbit/model-budget';

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

/**
 * What one call produced, and what it cost in tokens.
 *
 * Usage travels with the proposal rather than through a side channel, because
 * the two are facts about the same call and a caller that could get one without
 * the other would eventually record a proposal it never billed. `usage` is null
 * only when the provider genuinely did not report any — a fact worth keeping
 * distinguishable from "zero tokens", which is not a thing that happens.
 */
export interface SopGraphProposalResponse {
  /** The model's structured output, unvalidated. */
  readonly proposal: unknown;
  readonly usage: ModelCallUsage | null;
}

/** What a rule-drafting call produced, and what it cost. Same pairing, same reason. */
export interface RuleProposalResponse {
  /** The model's structured output, unvalidated. */
  readonly proposal: unknown;
  readonly usage: ModelCallUsage | null;
}

export interface LLMProvider {
  readonly descriptor: ProviderDescriptor;
  /** Returns the model's structured output and its token usage. Throws SopProviderError. */
  generateSopGraphProposal(request: SopGraphProposalRequest): Promise<SopGraphProposalResponse>;
  /**
   * Drafts one business rule into a decision step (ADR-040).
   *
   * On this port rather than its own, because it is the same boundary answering
   * a second question with the same credentials, the same failure type, and the
   * same "returns what the model produced, validates nothing" contract. A
   * second provider interface would mean a second factory, a second set of
   * environment variables to resolve, and a second thing to keep in step.
   */
  draftRuleDecision(request: RuleDraftingRequest): Promise<RuleProposalResponse>;
}

/** The rule, and the closed lists the model may draw names from. */
export interface RuleDraftingRequest {
  readonly ruleText: string;
  readonly availableValues: readonly { readonly name: string; readonly readAtStepId: string }[];
  readonly inputs: readonly string[];
  readonly steps: readonly {
    readonly id: string;
    readonly kind: string;
    readonly summary: string;
  }[];
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
    generateSopGraphProposal(): Promise<SopGraphProposalResponse> {
      return Promise.reject(new SopProviderError(reason, { provider: 'unconfigured' }));
    },
    draftRuleDecision(): Promise<RuleProposalResponse> {
      return Promise.reject(new SopProviderError(reason, { provider: 'unconfigured' }));
    },
  };
}
