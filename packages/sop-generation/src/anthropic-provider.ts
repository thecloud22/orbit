import { ChatAnthropic } from '@langchain/anthropic';

import { sopGraphProposalSchema, type SopGraphProposal } from './proposal';
import { buildGenerationMessage, SOP_GENERATION_SYSTEM_PROMPT } from './prompt';
import type { ModelCallUsage } from './budget';
import {
  SopProviderError,
  type LLMProvider,
  type SopGraphProposalRequest,
  type SopGraphProposalResponse,
} from './provider';

/**
 * The Anthropic-backed provider.
 *
 * This is the only module in the package that imports LangChain, and a test
 * asserts it stays that way. Everything else — the schema, the prompt, the
 * pipeline, the repair policy — is ordinary code that runs with no network and
 * no model, which is what makes the rest of this package testable at all.
 *
 * LangChain is used at the model layer only: a chat model, a schema bound to
 * it, one call. No agent, no chain, no memory, no retrieval, no graph. A single
 * generate-then-validate call needs none of that, and the SOP Graph is already
 * the state machine.
 */

export const ANTHROPIC_PROVIDER_NAME = 'anthropic';

/**
 * Sonnet by default.
 *
 * This is bounded structured extraction behind a strict schema and a repair
 * loop: what makes the output trustworthy is the validator, not model size.
 */
export const DEFAULT_SOP_GENERATION_MODEL = 'claude-sonnet-5';

export interface AnthropicSopProviderOptions {
  readonly apiKey: string;
  readonly model?: string;
  /** Deterministic by default; this is extraction, not composition. */
  readonly temperature?: number;
  readonly maxRetries?: number;
}

/**
 * Pulls the model's own output back out of the response.
 *
 * `includeRaw` is set so LangChain returns the tool call rather than throwing
 * when the arguments do not satisfy the bound schema. That matters: an invalid
 * proposal has to arrive at the validator as data, so the repair loop can tell
 * the model exactly what was wrong. If it surfaced as a thrown provider error
 * instead, every schema slip would look like an outage and no repair would ever
 * be attempted.
 */
function unvalidatedArguments(response: {
  readonly raw: unknown;
  readonly parsed: SopGraphProposal;
}): unknown {
  const raw = response.raw;

  if (typeof raw === 'object' && raw !== null && 'tool_calls' in raw) {
    const toolCalls = (raw as { readonly tool_calls?: unknown }).tool_calls;

    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      const first: unknown = toolCalls[0];

      if (typeof first === 'object' && first !== null && 'args' in first) {
        return (first as { readonly args: unknown }).args;
      }
    }
  }

  // No tool call to read: fall back to whatever LangChain parsed, which may be
  // undefined when the model answered in prose. The validator decides.
  return response.parsed;
}

/**
 * The token counts the provider reported, or null when it reported none.
 *
 * Read off the raw `AIMessage`, which is available only because `includeRaw` is
 * already set for the repair loop's sake. Read defensively — the shape is
 * LangChain's rather than ours — and a call whose usage cannot be read is
 * recorded as unknown rather than as zero: a budget that silently treats an
 * unreadable call as free is a budget with a hole in it, and the pipeline
 * charges an assumed cost for one instead.
 */
function usageOf(raw: unknown): ModelCallUsage | null {
  if (typeof raw !== 'object' || raw === null || !('usage_metadata' in raw)) {
    return null;
  }

  const metadata = (raw as { readonly usage_metadata?: unknown }).usage_metadata;

  if (typeof metadata !== 'object' || metadata === null) {
    return null;
  }

  const input = (metadata as { readonly input_tokens?: unknown }).input_tokens;
  const output = (metadata as { readonly output_tokens?: unknown }).output_tokens;

  if (typeof input !== 'number' || typeof output !== 'number') {
    return null;
  }

  return { inputTokens: input, outputTokens: output };
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
