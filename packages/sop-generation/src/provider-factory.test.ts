import { resolveModelSelection } from '@orbit/model-provider';
import { describe, expect, it } from 'vitest';

import { isSopProviderError } from './provider';
import { createSopProvider } from './provider-factory';

/**
 * What the factory promises.
 *
 * These construct a real client but never call one — building a `ChatAnthropic`,
 * a `ChatGoogleGenerativeAI` or a `ChatBedrockConverse` opens no connection — so
 * the descriptor is observable without a network, a key, or a cloud account.
 *
 * The factory no longer decides *which* provider: that is one question for the
 * whole application and @orbit/model-provider answers it (ADR-034). What is
 * left, and what these assert, is that drafting follows whatever was selected
 * and that missing configuration produces a provider which fails on use rather
 * than one that throws at construction.
 */

describe('createSopProvider', () => {
  it('follows the selection to Anthropic, invoked directly', () => {
    const provider = createSopProvider(resolveModelSelection({ ANTHROPIC_API_KEY: 'sk-test' }));

    expect(provider.descriptor).toEqual({ provider: 'anthropic', model: 'claude-haiku-4-5' });
  });

  it('follows the same selection to Gemini, with no change here at all', () => {
    // The point of the whole change: drafting has no provider-specific branch
    // left, so a second family costs this file nothing.
    const provider = createSopProvider(
      resolveModelSelection({ LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'goog-test' }),
    );

    expect(provider.descriptor).toEqual({ provider: 'gemini', model: 'gemini-2.5-flash-lite' });
  });

  it('follows the same selection through Bedrock', () => {
    const provider = createSopProvider(
      resolveModelSelection({ LLM_INVOCATION: 'bedrock', AWS_REGION: 'us-east-1' }),
    );

    expect(provider.descriptor).toEqual({
      provider: 'bedrock',
      model: 'anthropic.claude-haiku-4-5',
    });
  });

  it('reports the model the ledger must key on', () => {
    // Cost is estimated from `descriptor.model`. A Bedrock call recorded under
    // a first-party id would be costed against the wrong row.
    expect(
      createSopProvider(
        resolveModelSelection({ LLM_INVOCATION: 'bedrock', AWS_REGION: 'us-east-1' }),
      ).descriptor.model,
    ).toMatch(/^anthropic\./);
  });

  describe('missing configuration', () => {
    /**
     * The behaviour `createUnconfiguredSopProvider` exists for, asserted rather
     * than assumed: construction succeeds so the API still boots, and the
     * failure lands on the one call that needs a model.
     */
    async function failureFrom(provider: ReturnType<typeof createSopProvider>): Promise<string> {
      try {
        await provider.generateSopGraphProposal({ sourceText: 'anything' });
      } catch (error) {
        expect(isSopProviderError(error)).toBe(true);
        return error instanceof Error ? error.message : String(error);
      }

      throw new Error('An unconfigured provider must reject.');
    }

    it('names the missing Anthropic key without failing to construct', async () => {
      const provider = createSopProvider(resolveModelSelection({}));

      expect(provider.descriptor.provider).toBe('unconfigured');

      const message = await failureFrom(provider);
      expect(message).toContain('ANTHROPIC_API_KEY');
      // And says which feature is affected, because the person reading it is
      // looking at a browser rather than at this file.
      expect(message).toContain('SOP generation is unavailable');
    });

    it('names the missing Gemini key when that is the family selected', async () => {
      const provider = createSopProvider(resolveModelSelection({ LLM_PROVIDER: 'gemini' }));

      expect(await failureFrom(provider)).toContain('GEMINI_API_KEY');
    });

    it('names the missing Bedrock region, and the variable that supplies it', async () => {
      const provider = createSopProvider(resolveModelSelection({ LLM_INVOCATION: 'bedrock' }));

      expect(provider.descriptor.provider).toBe('unconfigured');
      expect(await failureFrom(provider)).toContain('AWS_REGION');
    });
  });
});
