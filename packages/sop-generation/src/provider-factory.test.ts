import { describe, expect, it } from 'vitest';

import { ANTHROPIC_PROVIDER_NAME, DEFAULT_SOP_GENERATION_MODEL } from './anthropic-provider';
import { BEDROCK_PROVIDER_NAME, DEFAULT_BEDROCK_SOP_GENERATION_MODEL } from './bedrock-provider';
import { isSopProviderError } from './provider';
import { createSopProvider, isModelProviderName, MODEL_PROVIDER_NAMES } from './provider-factory';

/**
 * What the factory promises.
 *
 * These construct a real client but never call one — building a `ChatAnthropic`
 * or a `ChatBedrockConverse` opens no connection, so the descriptor is
 * observable without a network, a key, or an AWS account. That is the whole
 * contract worth asserting here: which provider was built, under which model,
 * and that missing configuration produces a provider that fails on use rather
 * than one that throws at construction.
 */

describe('createSopProvider', () => {
  it('defaults to Anthropic on the cheapest current Claude model', () => {
    const provider = createSopProvider({ provider: 'anthropic', apiKey: 'sk-test' });

    expect(provider.descriptor).toEqual({
      provider: ANTHROPIC_PROVIDER_NAME,
      model: DEFAULT_SOP_GENERATION_MODEL,
    });
    expect(DEFAULT_SOP_GENERATION_MODEL).toBe('claude-haiku-4-5');
  });

  it('builds a Bedrock provider from a region alone, with no credentials of its own', () => {
    // Credentials come from the AWS default provider chain. A region is the
    // only thing Orbit must be told, because Bedrock is region-scoped.
    const provider = createSopProvider({ provider: 'bedrock', region: 'us-east-1' });

    expect(provider.descriptor).toEqual({
      provider: BEDROCK_PROVIDER_NAME,
      model: DEFAULT_BEDROCK_SOP_GENERATION_MODEL,
    });
  });

  it('honours an explicit model on either provider', () => {
    expect(
      createSopProvider({ provider: 'anthropic', apiKey: 'sk-test', model: 'claude-sonnet-5' })
        .descriptor.model,
    ).toBe('claude-sonnet-5');

    expect(
      createSopProvider({
        provider: 'bedrock',
        region: 'eu-west-1',
        model: 'eu.anthropic.claude-haiku-4-5',
      }).descriptor.model,
    ).toBe('eu.anthropic.claude-haiku-4-5');
  });

  it('reports the model it will actually use, so the ledger keys on the right name', () => {
    // Cost is estimated from `descriptor.model`. A Bedrock call recorded under
    // a first-party id would be costed against the wrong row.
    expect(
      createSopProvider({ provider: 'bedrock', region: 'us-east-1' }).descriptor.model,
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
      const provider = createSopProvider({ provider: 'anthropic' });

      expect(provider.descriptor.provider).toBe('unconfigured');
      expect(await failureFrom(provider)).toContain('ANTHROPIC_API_KEY');
    });

    it('treats a blank key as missing rather than passing it to the client', async () => {
      const provider = createSopProvider({ provider: 'anthropic', apiKey: '   ' });

      expect(provider.descriptor.provider).toBe('unconfigured');
    });

    it('names the missing Bedrock region, and the variable that supplies it', async () => {
      const provider = createSopProvider({ provider: 'bedrock' });

      expect(provider.descriptor.provider).toBe('unconfigured');

      const message = await failureFrom(provider);
      expect(message).toContain('AWS_REGION');
      expect(message).toContain('bedrock');
    });
  });
});

describe('isModelProviderName', () => {
  it('accepts exactly the providers that exist', () => {
    expect(MODEL_PROVIDER_NAMES).toEqual(['anthropic', 'bedrock']);

    for (const name of MODEL_PROVIDER_NAMES) {
      expect(isModelProviderName(name)).toBe(true);
    }

    expect(isModelProviderName('bedrok')).toBe(false);
    expect(isModelProviderName('openai')).toBe(false);
    expect(isModelProviderName('')).toBe(false);
  });
});
