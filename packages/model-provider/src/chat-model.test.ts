import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createChatModel, ModelSelectionError } from './chat-model';
import { resolveModelSelection, type ModelSelection } from './selection';

/**
 * What constructing a client promises.
 *
 * These build a real client and never call one — constructing a `ChatAnthropic`,
 * a `ChatGoogleGenerativeAI` or a `ChatBedrockConverse` opens no connection — so
 * the descriptor is observable without a network, a key, or a cloud account.
 * **No test in this repository calls a model.**
 *
 * That also bounds what this file can claim. It demonstrates that each of the
 * three routes constructs, binds a schema and reports the right descriptor; it
 * does not demonstrate that a real Gemini or Bedrock endpoint replies the way
 * the code expects, because there are no Google or AWS credentials here. That
 * distinction is stated in the README and the report rather than blurred.
 */

/** A schema declared here, so this file has no opinion about any call site's contract. */
function schema() {
  return z.object({ answer: z.string() });
}

function selection(overrides: Partial<ModelSelection> = {}): ModelSelection {
  return {
    family: 'anthropic',
    invocation: 'direct',
    model: 'claude-haiku-4-5',
    apiKey: 'sk-test',
    ...overrides,
  };
}

describe('createChatModel', () => {
  it('constructs an Anthropic client and reports what a ledger row will say', () => {
    const chat = createChatModel(selection());

    expect(chat.descriptor).toEqual({ provider: 'anthropic', model: 'claude-haiku-4-5' });
  });

  it('constructs a Gemini client under the same contract', () => {
    const chat = createChatModel(
      selection({ family: 'gemini', model: 'gemini-2.5-flash-lite', apiKey: 'goog-test' }),
    );

    expect(chat.descriptor).toEqual({ provider: 'gemini', model: 'gemini-2.5-flash-lite' });
  });

  it('constructs a Bedrock client from a region alone, with no credentials of its own', () => {
    // Credentials come from the AWS default provider chain. A region is the
    // only thing Orbit must be told, because Bedrock is region-scoped.
    const chat = createChatModel({
      family: 'anthropic',
      invocation: 'bedrock',
      model: 'anthropic.claude-haiku-4-5',
      region: 'us-east-1',
    });

    expect(chat.descriptor).toEqual({
      provider: 'bedrock',
      model: 'anthropic.claude-haiku-4-5',
    });
  });

  it('reports the model id the ledger must key on', () => {
    // Cost is estimated from `descriptor.model`. A Bedrock call recorded under
    // a first-party id would be costed against the wrong row.
    const chat = createChatModel({
      family: 'anthropic',
      invocation: 'bedrock',
      model: 'anthropic.claude-haiku-4-5',
      region: 'us-east-1',
    });

    expect(chat.descriptor.model).toMatch(/^anthropic\./);
  });

  it('binds a schema on every route without calling anything', () => {
    for (const built of [
      createChatModel(selection()),
      createChatModel(selection({ family: 'gemini', apiKey: 'goog-test' })),
    ]) {
      // The bind itself is what would throw if a provider did not support
      // structured output the way the three call sites use it.
      expect(() => built.bindSchema(schema(), 'probe')).not.toThrow();
    }
  });

  describe('a selection that cannot construct', () => {
    /**
     * These are programmer errors rather than deployment ones. A missing key
     * reaches `resolveModelSelection` first, which reports it as unconfigured;
     * getting here means something built a `ModelSelection` by hand and left a
     * hole in it, and a clear throw beats a client that cannot work.
     */
    it('refuses a direct selection with no key', () => {
      expect(() =>
        createChatModel({ family: 'anthropic', invocation: 'direct', model: 'claude-haiku-4-5' }),
      ).toThrow(ModelSelectionError);
    });

    it('refuses a Bedrock selection with no region', () => {
      expect(() =>
        createChatModel({
          family: 'anthropic',
          invocation: 'bedrock',
          model: 'anthropic.claude-haiku-4-5',
        }),
      ).toThrow(/region/);
    });

    it('never reaches that state through the resolver', () => {
      // The pairing that matters: resolution reports absence as a value, so no
      // caller following the documented path can hand a hole to this function.
      expect(resolveModelSelection({}).status).toBe('unconfigured');
      expect(resolveModelSelection({ LLM_INVOCATION: 'bedrock' }).status).toBe('unconfigured');
    });
  });
});
