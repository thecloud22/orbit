import { createChatModel, usageOf, type ModelSelection } from '@orbit/model-provider';
import type { JudgeRequest } from '@orbit/runtime';
import { z } from 'zod';

import type { DecisionModel, DecisionModelAnswer } from './judge';
import { buildDecisionMessage, DECISION_SYSTEM_PROMPT } from './prompt';

/**
 * The model layer, over whichever model the deployment selected.
 *
 * The only file in this package that reaches a network, and a boundary test
 * keeps it that way. Which family it reaches and how — Anthropic or Gemini,
 * directly or through Bedrock — is not decided here: @orbit/model-provider
 * resolves that once for the whole application, and `apps/browser-worker`
 * hands the result in (ADR-034).
 *
 * **The bound on the answer is not the provider's to keep.** The schema below
 * asks for an integer inside the range, LangChain refuses a reply that does not
 * satisfy it, and @orbit/runtime re-validates the index a third time before it
 * reaches control flow. That last check is the guarantee, and it is deliberately
 * outside every provider — so switching family changes nothing about what an
 * index is allowed to be. It matters more than it looks: Gemini's structured
 * output is built on a schema subset that does not carry every JSON Schema
 * keyword, so a numeric bound is a request there rather than an enforcement.
 * Orbit does not rely on it being enforced by anyone but itself.
 */

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

export interface ChatDecisionModelOptions {
  readonly temperature?: number;
  readonly maxRetries?: number;
}

export function createChatDecisionModel(
  selection: ModelSelection,
  options: ChatDecisionModelOptions = {},
): DecisionModel {
  const chat = createChatModel(selection, {
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
    provider: chat.descriptor.provider,
    model: chat.descriptor.model,

    async decide(request: JudgeRequest): Promise<DecisionModelAnswer> {
      const call = chat.bindSchema(answerSchema(request.alternatives.length), 'decision');

      const response = await call.invoke(
        [
          { role: 'system', content: DECISION_SYSTEM_PROMPT },
          { role: 'user', content: buildDecisionMessage(request) },
        ],
        { timeoutMs: request.timeoutMs },
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
