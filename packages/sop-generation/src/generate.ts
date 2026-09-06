import {
  parseSopGraphDocument,
  SOP_GRAPH_SCHEMA_VERSION,
  type SopGraph,
  type SopGraphIssue,
} from '@orbit/sop-graph';

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
    }
  | {
      readonly ok: false;
      readonly reason: 'invalid_after_repair';
      readonly issues: readonly SopGraphIssue[];
      readonly attempts: 2;
    }
  | {
      readonly ok: false;
      readonly reason: 'provider_error';
      readonly message: string;
    };

export interface GenerateSopGraphInput {
  readonly provider: LLMProvider;
  readonly sourceText: string;
  /** Injected so a test can assert an exact `generatedAt`. */
  readonly now?: () => Date;
}

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

  try {
    const first = assembleDocument(
      await input.provider.generateSopGraphProposal({ sourceText: input.sourceText }),
    );
    const firstParse = parseSopGraphDocument(first);

    if (firstParse.ok) {
      return { ok: true, graph: firstParse.graph, generation: metadata(input.provider, now(), 1) };
    }

    // One repair, carrying the real issues. A bare "try again" would ask the
    // model to guess what was wrong with output it already considered correct.
    const second = assembleDocument(
      await input.provider.generateSopGraphProposal({
        sourceText: input.sourceText,
        repairContext: { previousAttempt: first, issues: firstParse.issues },
      }),
    );
    const secondParse = parseSopGraphDocument(second);

    if (secondParse.ok) {
      return { ok: true, graph: secondParse.graph, generation: metadata(input.provider, now(), 2) };
    }

    return { ok: false, reason: 'invalid_after_repair', issues: secondParse.issues, attempts: 2 };
  } catch (error) {
    // Only a declared provider failure is converted. Anything else is a defect
    // in this process, and swallowing it here would hide it behind a message
    // about the model.
    if (isSopProviderError(error)) {
      return { ok: false, reason: 'provider_error', message: error.message };
    }

    throw error;
  }
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
