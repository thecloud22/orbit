import { resolveModelSelection } from '@orbit/model-provider';
import { describe, expect, it } from 'vitest';

import { createAssistProvider } from './chat-assist-provider';

/**
 * Advice follows the same selection as everything else, and its absence is not
 * a failure.
 *
 * This was the call site the previous provider seam missed: it read
 * `ANTHROPIC_API_KEY` itself and defaulted to Sonnet, so switching family would
 * have moved drafting and judged decisions and left authoring advice behind on
 * a model nobody chose. **No test here calls a model.**
 */
const FINGERPRINT = {
  role: 'button',
  accessibleName: 'Search',
  text: 'Search',
  boundingBox: null,
} as const;

describe('createAssistProvider', () => {
  it('follows the selection to whichever family is configured', () => {
    expect(
      createAssistProvider(resolveModelSelection({ ANTHROPIC_API_KEY: 'sk-test' })).descriptor,
    ).toEqual({ provider: 'anthropic', model: 'claude-haiku-4-5' });

    expect(
      createAssistProvider(
        resolveModelSelection({ LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'goog-test' }),
      ).descriptor,
    ).toEqual({ provider: 'gemini', model: 'gemini-2.5-flash-lite' });
  });

  it('takes the deployment-wide default rather than a larger model of its own', () => {
    // It used to default to Sonnet. Reading a role, a name and some text and
    // saying whether they look related does not need it, and this assist runs
    // on every step a person records.
    expect(
      createAssistProvider(resolveModelSelection({ ANTHROPIC_API_KEY: 'sk-test' })).descriptor
        .model,
    ).not.toContain('sonnet');
  });

  describe('with no model configured', () => {
    /**
     * Advice is optional by definition, so an unconfigured deployment must
     * degrade the recorder to "no suggestions" rather than break it. The null
     * object is production behaviour, not a test double.
     */
    it('constructs, and fails only when asked for advice', async () => {
      const provider = createAssistProvider(resolveModelSelection({}));

      expect(provider.descriptor.provider).toBe('unconfigured');

      await expect(
        provider.checkSemanticMatch({
          stepPurpose: 'search for a request',
          stepKind: 'act',
          fingerprint: FINGERPRINT,
          selectors: [{ strategy: 'test_id', value: 'search-request-button' }],
        }),
      ).rejects.toThrow(/ANTHROPIC_API_KEY/);
    });

    it('says which feature is unavailable, and that the rest still works', async () => {
      const provider = createAssistProvider(resolveModelSelection({ LLM_PROVIDER: 'gemini' }));

      await expect(
        provider.rankDriftCandidates({
          stepPurpose: 'search for a request',
          expected: FINGERPRINT,
          candidates: [],
        }),
      ).rejects.toThrow(/GEMINI_API_KEY[\s\S]*Recording assists are unavailable/);
    });
  });
});
