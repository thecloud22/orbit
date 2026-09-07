import {
  parseSopGraphDocument,
  SOP_GRAPH_SCHEMA_VERSION,
  type SopGraph,
  type SopGraphIssue,
} from '@orbit/sop-graph';

import {
  ASSUMED_TOKENS_PER_CALL,
  checkModelBudget,
  type BudgetRefusal,
  type ModelBudgets,
  type ModelCallUsage,
  type ModelSpend,
} from './budget';
import { SOP_GENERATION_PROMPT_VERSION } from './prompt';
import { isSopProviderError, type LLMProvider } from './provider';

/**
 * Generation: ask, assemble, validate, and repair exactly once.
 *
 * Model output is untrusted input. It reaches persistence only through
 * `parseSopGraphDocument`, which runs the schema and then every graph rule the
 * SOP Graph package defines — the validator built in sub-phase 2.1 precisely so
 * that this one does not have to invent its own.
 */

export interface GenerationMetadata {
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  /** ISO-8601, recorded in the revision's provenance. */
  readonly generatedAt: string;
  readonly attempts: 1 | 2;
}

/** What one call spent, as the caller must record it. */
export interface RecordedModelCall {
  readonly attempt: 1 | 2;
  readonly usage: ModelCallUsage;
  /** True when the provider reported nothing and the assumed size was charged. */
  readonly assumed: boolean;
}

/**
 * Three outcomes, and they are kept apart on purpose.
 *
 * A model that produced an unusable graph and a provider that could not be
 * reached are different events with different responses — one is worth showing
 * a reviewer as validation issues, the other is an operational failure — and
 * collapsing them into a single "it didn't work" would lose that.
 */
export type SopGenerationResult =
  | {
      readonly ok: true;
      readonly graph: SopGraph;
      readonly generation: GenerationMetadata;
      readonly calls: readonly RecordedModelCall[];
    }
  | {
      readonly ok: false;
      readonly reason: 'invalid_after_repair';
      readonly issues: readonly SopGraphIssue[];
      readonly attempts: 2;
      readonly calls: readonly RecordedModelCall[];
    }
  | {
      readonly ok: false;
      readonly reason: 'provider_error';
      readonly message: string;
      readonly calls: readonly RecordedModelCall[];
    }
  /**
   * The first call produced an invalid graph and the repair was not affordable.
   *
   * Kept distinct from `invalid_after_repair` on purpose. Both leave the person
   * with an invalid draft, but only one of them means "the model tried twice and
   * could not"; reporting a refused repair as a failed one would blame the model
   * for a budget decision, and hide the fact that raising the ceiling is what
   * would fix it.
   */
  | {
      readonly ok: false;
      readonly reason: 'budget_exhausted_before_repair';
      readonly issues: readonly SopGraphIssue[];
      readonly refusal: BudgetRefusal;
      readonly calls: readonly RecordedModelCall[];
    }
  /** No call was made at all: a budget was already exhausted. */
  | {
      readonly ok: false;
      readonly reason: 'budget_exhausted';
      readonly refusal: BudgetRefusal;
      readonly calls: readonly RecordedModelCall[];
    };

export interface GenerateSopGraphInput {
  readonly provider: LLMProvider;
  readonly sourceText: string;
  /** Injected so a test can assert an exact `generatedAt`. */
  readonly now?: () => Date;
  /** Ceilings per scope. Absent scopes are uncapped; absent entirely is uncapped. */
  readonly budgets?: ModelBudgets;
  /**
   * What each scope has already spent, read once before the first call.
   *
   * Supplied by the caller rather than read here, because this package has no
   * database — the same boundary that keeps generation testable with no model.
   * The second call's check adds this run's own first call to it, so a repair
   * is measured against a total that includes the attempt it is repairing.
   */
  readonly spend?: ModelSpend;
}

const NO_SPEND: ModelSpend = { global: 0, document: 0, request: 0 };

/**
 * Adds the schema version the model was never asked for.
 *
 * A `schemaVersion` the model volunteered anyway is overwritten rather than
 * merged: the field states which contract this document claims to satisfy, and
 * that claim is this codebase's to make.
 */
function assembleDocument(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    // Not a document shape at all. Passed through untouched so the validator
    // reports what it actually received instead of a synthesised object.
    return raw;
  }

  return { ...(raw as Record<string, unknown>), schemaVersion: SOP_GRAPH_SCHEMA_VERSION };
}

export async function generateSopGraph(input: GenerateSopGraphInput): Promise<SopGenerationResult> {
  const now = input.now ?? (() => new Date());
  const budgets = input.budgets ?? {};
  const baseline = input.spend ?? NO_SPEND;

  // Every call this run makes, in order. It is returned on every outcome —
  // success, refusal and failure alike — because a call that happened has to be
  // recorded whatever became of what it produced.
  const calls: RecordedModelCall[] = [];

  /** The baseline plus whatever this run has spent so far, in every scope. */
  function spendNow(): ModelSpend {
    const used = calls.reduce(
      (total, call) => total + call.usage.inputTokens + call.usage.outputTokens,
      0,
    );

    return {
      global: baseline.global + used,
      document: baseline.document + used,
      request: baseline.request + used,
    };
  }

  try {
    const beforeFirst = checkModelBudget({ budgets, spend: spendNow() });

    if (!beforeFirst.allowed) {
      return { ok: false, reason: 'budget_exhausted', refusal: beforeFirst.refusal, calls };
    }

    const firstResponse = await input.provider.generateSopGraphProposal({
      sourceText: input.sourceText,
    });
    calls.push(recordCall(1, firstResponse.usage));

    const first = assembleDocument(firstResponse.proposal);
    const firstParse = parseSopGraphDocument(first);

    if (firstParse.ok) {
      return {
        ok: true,
        graph: firstParse.graph,
        generation: metadata(input.provider, now(), 1),
        calls,
      };
    }

    // The second check is the one that matters most, and it is why the budget
    // is not simply consulted once at the top: the first call has now spent
    // real tokens, and the repair must be measured against the total including
    // them. Refusing here returns the invalid draft's own issues alongside the
    // reason, so nothing is silently half-done.
    const beforeRepair = checkModelBudget({ budgets, spend: spendNow() });

    if (!beforeRepair.allowed) {
      return {
        ok: false,
        reason: 'budget_exhausted_before_repair',
        issues: firstParse.issues,
        refusal: beforeRepair.refusal,
        calls,
      };
    }

    // One repair, carrying the real issues. A bare "try again" would ask the
    // model to guess what was wrong with output it already considered correct.
    const secondResponse = await input.provider.generateSopGraphProposal({
      sourceText: input.sourceText,
      repairContext: { previousAttempt: first, issues: firstParse.issues },
    });
    calls.push(recordCall(2, secondResponse.usage));

    const second = assembleDocument(secondResponse.proposal);
    const secondParse = parseSopGraphDocument(second);

    if (secondParse.ok) {
      return {
        ok: true,
        graph: secondParse.graph,
        generation: metadata(input.provider, now(), 2),
        calls,
      };
    }

    return {
      ok: false,
      reason: 'invalid_after_repair',
      issues: secondParse.issues,
      attempts: 2,
      calls,
    };
  } catch (error) {
    // Only a declared provider failure is converted. Anything else is a defect
    // in this process, and swallowing it here would hide it behind a message
    // about the model.
    if (isSopProviderError(error)) {
      return { ok: false, reason: 'provider_error', message: error.message, calls };
    }

    throw error;
  }
}

/**
 * One call, with an assumed size when the provider reported none.
 *
 * Charging the assumption rather than zero is the whole point: a provider that
 * stops reporting usage must not silently become free, because the next check
 * would then let an unbounded number of calls through.
 */
function recordCall(attempt: 1 | 2, usage: ModelCallUsage | null): RecordedModelCall {
  return usage === null
    ? { attempt, usage: { inputTokens: ASSUMED_TOKENS_PER_CALL, outputTokens: 0 }, assumed: true }
    : { attempt, usage, assumed: false };
}

function metadata(provider: LLMProvider, at: Date, attempts: 1 | 2): GenerationMetadata {
  return {
    provider: provider.descriptor.provider,
    model: provider.descriptor.model,
    promptVersion: SOP_GENERATION_PROMPT_VERSION,
    generatedAt: at.toISOString(),
    attempts,
  };
}
