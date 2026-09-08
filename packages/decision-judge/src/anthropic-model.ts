import { ChatAnthropic } from '@langchain/anthropic';
import type { JudgeRequest } from '@orbit/runtime';
import { z } from 'zod';

import type { DecisionModel, DecisionModelAnswer } from './judge';
import { buildDecisionMessage, DECISION_SYSTEM_PROMPT } from './prompt';

/**
 * The Anthropic-backed model layer.
 *
 * The only file in this package that reaches a network, and a boundary test
 * keeps it that way. LangChain is used exactly as @orbit/sop-generation uses
 * it: a chat model, a schema bound to it, one call. No agent, no chain, no
 * memory, no tools — a classification into a closed list needs none of that,
 * and every one of them would be a capability to take back later.
 */

export const ANTHROPIC_JUDGE_PROVIDER_NAME = 'anthropic';

/**
 * The cheapest current Claude model, by default.
 *
 * This is a closed-set classification behind a strict schema, an independent
 * re-validation in the runtime, and a confidence floor that halts the run. What
 * makes the answer trustworthy is those three, not model size — and a judged
 * decision runs on every execution, so the default should be the one a
 * deployment can afford to run often. Overridable per deployment.
 */
export const DEFAULT_DECISION_MODEL = 'claude-haiku-4-5';

/**
 * The answer schema.
 *
 * `alternativeIndex` is an integer in range rather than an outcome string: an
 * index cannot be a locator, a URL, an expression or a step id, and there is no
 * spelling of it that becomes one. `rationale` is the only free text the model
 * may produce, it is capped, and nothing reads it.
 */
function answerSchema(alternativeCount: number) {
  return z.object({
    alternativeIndex: z
      .number()
      .int()
      .min(0)
      .max(alternativeCount - 1)
      .describe('The zero-based index of the chosen alternative.'),
    confidence: z
      .number()
      .min(0)
      .max(1)
      .describe(
        'How confident you are, from 0 to 1. Be honest; a low value stops the workflow safely.',
      ),
    rationale: z
      .string()
      .max(500)
      .describe('One or two sentences citing the page content that decided it.'),
  });
}

export interface AnthropicDecisionModelOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly temperature?: number;
  readonly maxRetries?: number;
}

export function createAnthropicDecisionModel(
  options: AnthropicDecisionModelOptions,
): DecisionModel {
  const model = options.model ?? DEFAULT_DECISION_MODEL;

  const chat = new ChatAnthropic({
    apiKey: options.apiKey,
    model,
    // Deterministic as far as a model gets. This is classification, not
    // composition, and two runs of the same agent against the same page
    // differing is the property this whole feature has to keep small.
    temperature: options.temperature ?? 0,
    // One attempt by default. A retry is a second chance at a *different*
    // answer, which is exactly what a bounded decision must not have; the
    // runtime's fail-closed halt is the correct response to a failed call.
    maxRetries: options.maxRetries ?? 0,
  });

  return {
    provider: ANTHROPIC_JUDGE_PROVIDER_NAME,
    model,

    async decide(request: JudgeRequest): Promise<DecisionModelAnswer> {
      const structured = chat.withStructuredOutput<z.infer<ReturnType<typeof answerSchema>>>(
        answerSchema(request.alternatives.length),
        { name: 'decision', includeRaw: true },
      );

      const response = await structured.invoke(
        [
          { role: 'system', content: DECISION_SYSTEM_PROMPT },
          { role: 'user', content: buildDecisionMessage(request) },
        ],
        { timeout: request.timeoutMs },
      );

      const parsed = response.parsed;

      // A reply that does not satisfy the schema is a provider failure, not
      // something to salvage. There is no repair loop here on purpose: a second
      // ask is a second answer, and the runtime halting is the safe outcome.
      if (parsed === undefined || parsed === null) {
        throw new Error('The model did not return a decision matching the required schema.');
      }

      return {
        alternativeIndex: parsed.alternativeIndex,
        confidence: parsed.confidence,
        ...(parsed.rationale === undefined ? {} : { rationale: parsed.rationale }),
        usage: usageOf(response.raw),
      };
    },
  };
}

/** Token counts the provider reported, or null when it reported none. */
function usageOf(raw: unknown): DecisionModelAnswer['usage'] {
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
