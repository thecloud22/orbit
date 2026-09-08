import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MODELS,
  DEFAULT_MODEL_IDS,
  INVOCATION_MODES,
  MODEL_FAMILIES,
  providerLabel,
  resolveModelSelection,
} from './selection';

/**
 * The whole point of the selection layer, asserted.
 *
 * Every case passes an explicit environment object rather than mutating
 * `process.env` — the same discipline the budget resolvers keep — which is what
 * stops these tests leaking into each other and is only possible because
 * nothing in `selection.ts` reaches for a global.
 *
 * No test here calls a model. Nothing in this file constructs a client at all.
 */

function configured(env: Record<string, string | undefined>) {
  const resolution = resolveModelSelection(env);

  if (resolution.status !== 'configured') {
    throw new Error(`Expected a configured selection, got: ${resolution.reason}`);
  }

  return resolution;
}

describe('the two axes', () => {
  it('defaults to Anthropic, invoked directly, on the cheapest current model', () => {
    const { selection } = configured({ ANTHROPIC_API_KEY: 'sk-test' });

    expect(selection.family).toBe('anthropic');
    expect(selection.invocation).toBe('direct');
    expect(selection.model).toBe('claude-haiku-4-5');
    expect(selection.apiKey).toBe('sk-test');
    expect(selection.region).toBeUndefined();
  });

  it('varies family and invocation independently', () => {
    // This is the property the whole change exists for: the same family,
    // reached two ways, is a deployment setting and not a code change.
    const direct = configured({ LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-test' });
    const viaBedrock = configured({
      LLM_PROVIDER: 'anthropic',
      LLM_INVOCATION: 'bedrock',
      AWS_REGION: 'us-east-1',
    });

    expect(direct.selection.family).toBe(viaBedrock.selection.family);
    expect(direct.selection.invocation).toBe('direct');
    expect(viaBedrock.selection.invocation).toBe('bedrock');

    // The same model, under the id each route names it by.
    expect(direct.selection.model).toBe('claude-haiku-4-5');
    expect(viaBedrock.selection.model).toBe('anthropic.claude-haiku-4-5');
  });

  it('selects Gemini on its own key and its own default model', () => {
    const { selection } = configured({ LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'goog-test' });

    expect(selection.family).toBe('gemini');
    expect(selection.invocation).toBe('direct');
    expect(selection.model).toBe('gemini-2.5-flash-lite');
    expect(selection.apiKey).toBe('goog-test');
  });

  it('reads GOOGLE_API_KEY too, because the Google SDK does', () => {
    // If Orbit ignored it, a key that the underlying client would happily pick
    // up out of the environment would be reported here as "unconfigured".
    const { selection } = configured({ LLM_PROVIDER: 'gemini', GOOGLE_API_KEY: 'goog-test' });

    expect(selection.apiKey).toBe('goog-test');
  });

  it('prefers GEMINI_API_KEY when both are set', () => {
    const { selection } = configured({
      LLM_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'preferred',
      GOOGLE_API_KEY: 'other',
    });

    expect(selection.apiKey).toBe('preferred');
  });

  it('is case- and whitespace-insensitive about the axis values', () => {
    const { selection } = configured({
      LLM_PROVIDER: '  GEMINI ',
      LLM_INVOCATION: ' Direct ',
      GEMINI_API_KEY: 'goog-test',
    });

    expect(selection.family).toBe('gemini');
    expect(selection.invocation).toBe('direct');
  });
});

describe('models', () => {
  it('honours the family model variable over the default', () => {
    expect(
      configured({ ANTHROPIC_API_KEY: 'sk-test', ANTHROPIC_MODEL: 'claude-sonnet-5' }).selection
        .model,
    ).toBe('claude-sonnet-5');

    expect(
      configured({
        LLM_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'goog-test',
        GEMINI_MODEL: 'gemini-2.5-pro',
      }).selection.model,
    ).toBe('gemini-2.5-pro');
  });

  it('ignores the other family’s model variable', () => {
    // Otherwise switching family would carry a model id that family has never
    // heard of, and the failure would arrive from someone else's API.
    expect(
      configured({
        LLM_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'goog-test',
        ANTHROPIC_MODEL: 'claude-sonnet-5',
      }).selection.model,
    ).toBe('gemini-2.5-flash-lite');
  });

  it('lets a call site override the model for itself', () => {
    // The judge's `ORBIT_LLM_DECISION_MODEL` is this: a decision runs on every
    // execution, so it may want a different cost profile from drafting.
    const resolution = resolveModelSelection(
      { ANTHROPIC_API_KEY: 'sk-test', ANTHROPIC_MODEL: 'claude-sonnet-5' },
      { modelOverride: 'claude-opus-5' },
    );

    expect(resolution.status === 'configured' && resolution.selection.model).toBe('claude-opus-5');
  });

  it('has a priced default for every family and invocation it can select', () => {
    expect(DEFAULT_MODEL_IDS).toEqual([
      DEFAULT_MODELS['anthropic:direct'],
      DEFAULT_MODELS['anthropic:bedrock'],
      DEFAULT_MODELS['gemini:direct'],
    ]);
  });
});

describe('a configuration that cannot work', () => {
  it('refuses gemini through Bedrock at resolution, naming the problem', () => {
    // Bedrock does not serve Gemini. The useful moment to say so is startup,
    // not the first drafting request of the day as an opaque "model not found".
    expect(() =>
      resolveModelSelection({
        LLM_PROVIDER: 'gemini',
        LLM_INVOCATION: 'bedrock',
        AWS_REGION: 'us-east-1',
        GEMINI_API_KEY: 'goog-test',
      }),
    ).toThrow(/Bedrock does not serve Gemini/);
  });

  it('refuses an unrecognised family rather than falling back', () => {
    // A deployment that typed `gemni` meant Gemini; serving it Anthropic would
    // bill an account it never chose.
    expect(() => resolveModelSelection({ LLM_PROVIDER: 'gemni' })).toThrow(/LLM_PROVIDER/);
    expect(() => resolveModelSelection({ LLM_PROVIDER: 'openai' })).toThrow(/anthropic, gemini/);
  });

  it('refuses an unrecognised invocation rather than falling back', () => {
    expect(() => resolveModelSelection({ LLM_INVOCATION: 'bedrok' })).toThrow(/LLM_INVOCATION/);
  });
});

describe('a configuration that is merely absent', () => {
  /**
   * Absent is not the same as wrong. Missing configuration must never stop a
   * process from starting: every route that does not need a model still works,
   * and the one that does says what is missing.
   */
  it('reports the missing Anthropic key without throwing', () => {
    const resolution = resolveModelSelection({});

    expect(resolution.status).toBe('unconfigured');
    expect(resolution.status === 'unconfigured' && resolution.reason).toContain(
      'ANTHROPIC_API_KEY',
    );
  });

  it('reports the missing Gemini key by its own name', () => {
    const resolution = resolveModelSelection({ LLM_PROVIDER: 'gemini' });

    expect(resolution.status === 'unconfigured' && resolution.reason).toContain('GEMINI_API_KEY');
  });

  it('treats a blank key as missing rather than passing it to a client', () => {
    expect(resolveModelSelection({ ANTHROPIC_API_KEY: '   ' }).status).toBe('unconfigured');
  });

  it('reports a missing Bedrock region, and the variables that supply it', () => {
    const resolution = resolveModelSelection({ LLM_INVOCATION: 'bedrock' });

    expect(resolution.status).toBe('unconfigured');
    expect(resolution.status === 'unconfigured' && resolution.reason).toContain('AWS_REGION');
    expect(resolution.status === 'unconfigured' && resolution.reason).toContain(
      'ORBIT_BEDROCK_REGION',
    );
  });

  it('needs no API key for Bedrock, only a region', () => {
    // Credentials come from the AWS default provider chain. Orbit holds none.
    const { selection } = configured({ LLM_INVOCATION: 'bedrock', AWS_REGION: 'us-east-1' });

    expect(selection.region).toBe('us-east-1');
    expect(selection.apiKey).toBeUndefined();
  });

  it('prefers an explicit Orbit region over an inherited AWS one', () => {
    const { selection } = configured({
      LLM_INVOCATION: 'bedrock',
      ORBIT_BEDROCK_REGION: 'eu-west-1',
      AWS_REGION: 'us-east-1',
    });

    expect(selection.region).toBe('eu-west-1');
  });
});

describe('the superseded names', () => {
  it('keeps a working .env working, and translates what it meant', () => {
    // ORBIT_LLM_PROVIDER=bedrock held both axes in one variable: Claude models
    // reached through Bedrock. It must still mean exactly that.
    const resolution = resolveModelSelection({
      ORBIT_LLM_PROVIDER: 'bedrock',
      ORBIT_LLM_MODEL: 'us.anthropic.claude-haiku-4-5',
      AWS_REGION: 'us-east-1',
    });

    expect(resolution.status).toBe('configured');

    if (resolution.status !== 'configured') {
      return;
    }

    expect(resolution.selection.family).toBe('anthropic');
    expect(resolution.selection.invocation).toBe('bedrock');
    expect(resolution.selection.model).toBe('us.anthropic.claude-haiku-4-5');
    expect(resolution.deprecations).toHaveLength(2);
    expect(resolution.deprecations.join(' ')).toContain('ORBIT_LLM_PROVIDER');
    expect(resolution.deprecations.join(' ')).toContain('ORBIT_LLM_MODEL');
  });

  it('translates the anthropic value to direct invocation', () => {
    const { selection } = configured({
      ORBIT_LLM_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'sk-test',
    });

    expect(selection.invocation).toBe('direct');
  });

  it('lets the new names win when both are set', () => {
    // A deployment that has adopted the new spelling said so more recently.
    // Preferring the old one would make migration impossible to finish.
    const { selection } = configured({
      ORBIT_LLM_PROVIDER: 'bedrock',
      LLM_PROVIDER: 'gemini',
      LLM_INVOCATION: 'direct',
      GEMINI_API_KEY: 'goog-test',
      ORBIT_LLM_MODEL: 'claude-haiku-4-5',
      GEMINI_MODEL: 'gemini-2.5-flash',
    });

    expect(selection.family).toBe('gemini');
    expect(selection.invocation).toBe('direct');
    expect(selection.model).toBe('gemini-2.5-flash');
  });

  it('refuses to hand the superseded model variable to the other family', () => {
    // ORBIT_LLM_MODEL predates a second family, so every value anyone has put
    // in it is a Claude or Bedrock id. Passing one to Gemini would fail at
    // Google's API for a variable the deployment thought it had left behind.
    const resolution = resolveModelSelection({
      LLM_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'goog-test',
      ORBIT_LLM_MODEL: 'claude-haiku-4-5',
    });

    expect(resolution.status === 'configured' && resolution.selection.model).toBe(
      'gemini-2.5-flash-lite',
    );
    expect(resolution.deprecations.join(' ')).toContain('was ignored');
  });

  it('says nothing when no superseded name is set', () => {
    expect(configured({ ANTHROPIC_API_KEY: 'sk-test' }).deprecations).toEqual([]);
  });

  it('still refuses a value the old variable never accepted', () => {
    expect(() => resolveModelSelection({ ORBIT_LLM_PROVIDER: 'gemini' })).toThrow(
      /ORBIT_LLM_PROVIDER/,
    );
  });
});

describe('providerLabel', () => {
  it('keeps the values already in the spend ledger meaning what they meant', () => {
    // No migration, and no re-reading of history: `anthropic` and `bedrock` are
    // the two labels that already exist in `model_usage`.
    expect(
      providerLabel({ family: 'anthropic', invocation: 'direct', model: 'claude-haiku-4-5' }),
    ).toBe('anthropic');

    expect(
      providerLabel({
        family: 'anthropic',
        invocation: 'bedrock',
        model: 'anthropic.claude-haiku-4-5',
      }),
    ).toBe('bedrock');

    expect(
      providerLabel({ family: 'gemini', invocation: 'direct', model: 'gemini-2.5-flash-lite' }),
    ).toBe('gemini');
  });
});

describe('the vocabulary', () => {
  it('is exactly the two families and the two invocations that exist', () => {
    expect(MODEL_FAMILIES).toEqual(['anthropic', 'gemini']);
    expect(INVOCATION_MODES).toEqual(['direct', 'bedrock']);
  });
});
