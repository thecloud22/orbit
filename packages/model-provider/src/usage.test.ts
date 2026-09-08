import { describe, expect, it } from 'vitest';

import { usageOf } from './usage';

/**
 * One reader for every provider.
 *
 * The claim being tested is that the `model_usage` ledger and all three budget
 * scopes behave the same whichever family is active, and this is the function
 * that has to hold it up: LangChain normalises `usage_metadata` across chat
 * models, and everything downstream keys on that one shape.
 *
 * The other half of the claim is the negative one. A call whose usage cannot be
 * read is `null` — unknown — rather than zero, because a budget that treats an
 * unreadable call as free is a budget with a hole in it.
 */
describe('usageOf', () => {
  it('reads the normalised shape every provider arrives in', () => {
    expect(usageOf({ usage_metadata: { input_tokens: 120, output_tokens: 45 } })).toEqual({
      inputTokens: 120,
      outputTokens: 45,
    });
  });

  it('ignores extra fields a provider adds', () => {
    // Gemini reports cached and thinking counts; Bedrock reports latency. None
    // of them may change what a budget is charged.
    expect(
      usageOf({
        usage_metadata: {
          input_tokens: 10,
          output_tokens: 20,
          total_tokens: 30,
          input_token_details: { cache_read: 4 },
        },
      }),
    ).toEqual({ inputTokens: 10, outputTokens: 20 });
  });

  it('reports unknown rather than zero when there is nothing to read', () => {
    expect(usageOf(undefined)).toBeNull();
    expect(usageOf(null)).toBeNull();
    expect(usageOf({})).toBeNull();
    expect(usageOf({ usage_metadata: null })).toBeNull();
    expect(usageOf({ usage_metadata: {} })).toBeNull();
    expect(usageOf({ usage_metadata: { input_tokens: '12', output_tokens: 3 } })).toBeNull();
    expect(usageOf({ usage_metadata: { input_tokens: 12 } })).toBeNull();
  });
});
