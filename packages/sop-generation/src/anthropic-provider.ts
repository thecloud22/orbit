import { ChatAnthropic } from '@langchain/anthropic';

import { sopGraphProposalSchema, type SopGraphProposal } from './proposal';
import { buildGenerationMessage, SOP_GENERATION_SYSTEM_PROMPT } from './prompt';
import { unvalidatedArguments, usageOf } from './structured-response';
import {
  SopProviderError,
  type LLMProvider,
  type SopGraphProposalRequest,
  type SopGraphProposalResponse,
} from './provider';

/**
 * The Anthropic-backed provider.
 *
 * This and `bedrock-provider.ts` are the only modules in the package that
 * import LangChain, and a test asserts it stays that way. Everything else — the
 * schema, the prompt, the pipeline, the repair policy — is ordinary code that
 * runs with no network and no model, which is what makes the rest of this
 * package testable at all.
 *
 * LangChain is used at the model layer only: a chat model, a schema bound to
 * it, one call. No agent, no chain, no memory, no retrieval, no graph. A single
 * generate-then-validate call needs none of that, and the SOP Graph is already
 * the state machine.
 */

export const ANTHROPIC_PROVIDER_NAME = 'anthropic';

/**
 * The cheapest current Claude model, by default.
 *
 * This is bounded structured extraction behind a strict schema and a repair
 * loop: what makes the output trustworthy is the validator, not model size. The
 * default was Sonnet, which was paying for judgement this task does not ask for
 * — every proposal is parsed by `parseSopGraphDocument` before it is persisted,
 * and a weaker model that slips is corrected by the same repair pass that
 * already exists rather than trusted.
 *
 * Overridable per deployment; a deployment that finds Haiku's first attempt
 * needs repairing too often can buy its way out with one variable.
 */
export const DEFAULT_SOP_GENERATION_MODEL = 'claude-haiku-4-5';

export interface AnthropicSopProviderOptions {
  readonly apiKey: string;
  readonly model?: string;
  /** Deterministic by default; this is extraction, not composition. */
  readonly temperature?: number;
  readonly maxRetries?: number;
}

export function createAnthropicSopProvider(options: AnthropicSopProviderOptions): LLMProvider {
  const model = options.model ?? DEFAULT_SOP_GENERATION_MODEL;

  const chat = new ChatAnthropic({
    apiKey: options.apiKey,
    model,
    temperature: options.temperature ?? 0,
    maxRetries: options.maxRetries ?? 2,
  });

  const structured = chat.withStructuredOutput<SopGraphProposal>(sopGraphProposalSchema, {
    name: 'sop_graph_proposal',
    includeRaw: true,
  });

  return {
    descriptor: { provider: ANTHROPIC_PROVIDER_NAME, model },

    async generateSopGraphProposal(
      request: SopGraphProposalRequest,
    ): Promise<SopGraphProposalResponse> {
      try {
        const response = await structured.invoke([
          { role: 'system', content: SOP_GENERATION_SYSTEM_PROMPT },
          {
            role: 'user',
            content: buildGenerationMessage(request.sourceText, request.repairContext),
          },
        ]);

        return { proposal: unvalidatedArguments(response), usage: usageOf(response.raw) };
      } catch (error) {
        // Wrapped, never re-thrown bare: the pipeline converts exactly one
        // error type into a provider failure, and the original is kept as the
        // cause so the API can log it without ever serializing it.
        throw new SopProviderError(
          error instanceof Error
            ? `The model provider could not generate a proposal: ${error.message}`
            : 'The model provider could not generate a proposal.',
          { provider: ANTHROPIC_PROVIDER_NAME, cause: error },
        );
      }
    },
  };
}
