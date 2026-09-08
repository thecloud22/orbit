import type { ModelCallUsage } from '@orbit/model-budget';

/**
 * Reading token usage off a reply, identically for every provider.
 *
 * This lived in @orbit/sop-generation with a second, character-for-character
 * copy in @orbit/decision-judge. Two copies of this is how a budget comes to
 * mean two things depending on which call site spent it, so there is one now
 * and every provider is read through it.
 *
 * LangChain normalises `usage_metadata` across chat models — Anthropic's
 * `input_tokens`/`output_tokens`, Bedrock Converse's `inputTokens`/
 * `outputTokens`, and Gemini's `promptTokenCount`/`candidatesTokenCount` all
 * arrive here in one shape — which is what lets the `model_usage` ledger and
 * all three budget scopes work unchanged whichever provider is active. The
 * shape is still read defensively rather than trusted, because it is
 * LangChain's rather than ours.
 *
 * A call whose usage cannot be read is recorded as unknown rather than as zero.
 * A budget that silently treats an unreadable call as free is a budget with a
 * hole in it.
 *
 * Nothing here imports a model client, which is what keeps it on the near side
 * of every package's "one file may reach the network" boundary.
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
