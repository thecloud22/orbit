import type { ModelCallUsage } from '@orbit/model-budget';

/**
 * Reading a structured response, independently of who produced it.
 *
 * These two functions were written for the Anthropic provider and are now
 * shared with the Bedrock one. They live here rather than in either provider
 * because both providers must read a response *identically*: the repair loop
 * and the spend ledger are downstream of these, and a provider that reported
 * usage slightly differently would make a budget mean two things depending on
 * which one was configured.
 *
 * Nothing here imports LangChain. The shapes are read defensively and
 * structurally, which is also what keeps the package's "one file may reach the
 * network" boundary honest — this is not that file.
 */

/**
 * Pulls the model's own output back out of the response.
 *
 * `includeRaw` is set by every provider so LangChain returns the tool call
 * rather than throwing when the arguments do not satisfy the bound schema. That
 * matters: an invalid proposal has to arrive at the validator as data, so the
 * repair loop can tell the model exactly what was wrong. If it surfaced as a
 * thrown provider error instead, every schema slip would look like an outage
 * and no repair would ever be attempted.
 */
export function unvalidatedArguments(response: {
  readonly raw: unknown;
  readonly parsed: unknown;
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
 * already set for the repair loop's sake. LangChain normalises `usage_metadata`
 * across chat models, which is why one reader serves both providers — but it is
 * read defensively rather than trusted, because the shape is LangChain's rather
 * than ours.
 *
 * A call whose usage cannot be read is recorded as unknown rather than as zero:
 * a budget that silently treats an unreadable call as free is a budget with a
 * hole in it, and the pipeline charges an assumed cost for one instead.
 */
export function usageOf(raw: unknown): ModelCallUsage | null {
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
