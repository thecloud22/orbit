import { resolveModelSelection } from '@orbit/model-provider';
import { describe, expect, it } from 'vitest';

import { createChatDecisionModel } from './decision-model';

/**
 * The judge follows the same selection as everything else.
 *
 * Constructing a client opens no connection, so the descriptor is observable
 * with no network and no key. **No test here calls a model.**
 *
 * What these protect is the property Task 9 depends on and this change could
 * quietly have broken: the judge's provider and model are whatever the
 * deployment selected once, and they are what the `model_usage` ledger records.
 */
describe('createChatDecisionModel', () => {
  it('follows the selection to whichever family is configured', () => {
    const anthropic = createChatDecisionModel(
      resolveModelSelectionOrThrow({ ANTHROPIC_API_KEY: 'sk-test' }),
    );

    expect(anthropic.provider).toBe('anthropic');
    expect(anthropic.model).toBe('claude-haiku-4-5');

    const gemini = createChatDecisionModel(
      resolveModelSelectionOrThrow({ LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'goog-test' }),
    );

    expect(gemini.provider).toBe('gemini');
    expect(gemini.model).toBe('gemini-2.5-flash-lite');
  });

  it('records Bedrock under the id Bedrock reports, so the rate table keys on it', () => {
    const judge = createChatDecisionModel(
      resolveModelSelectionOrThrow({ LLM_INVOCATION: 'bedrock', AWS_REGION: 'us-east-1' }),
    );

    expect(judge.provider).toBe('bedrock');
    expect(judge.model).toBe('anthropic.claude-haiku-4-5');
  });

  it('honours a decision-specific model, whichever family is selected', () => {
    // A decision runs on every execution, so a deployment may want a different
    // cost profile for it than for drafting.
    const judge = createChatDecisionModel(
      resolveModelSelectionOrThrow(
        { LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'goog-test' },
        'gemini-2.5-pro',
      ),
    );

    expect(judge.model).toBe('gemini-2.5-pro');
  });
});

function resolveModelSelectionOrThrow(
  env: Record<string, string | undefined>,
  modelOverride?: string,
) {
  const resolution = resolveModelSelection(
    env,
    modelOverride === undefined ? {} : { modelOverride },
  );

  if (resolution.status !== 'configured') {
    throw new Error(resolution.reason);
  }

  return resolution.selection;
}
