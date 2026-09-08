import { describe, expect, it } from 'vitest';

import {
  BEDROCK_REGION_ENV_VARS,
  MODEL_ENV_VAR,
  PROVIDER_ENV_VAR,
  resolveProviderName,
  resolveSopProviderConfig,
} from './model-provider-env';

/**
 * Reading the provider configuration out of an environment.
 *
 * Every case passes an explicit environment object rather than mutating
 * `process.env`, which is what the budget resolver beside this already does and
 * what keeps these tests from leaking into each other.
 */

describe('resolveProviderName', () => {
  it('defaults to Anthropic when nothing is configured', () => {
    expect(resolveProviderName({})).toBe('anthropic');
    expect(resolveProviderName({ [PROVIDER_ENV_VAR]: '   ' })).toBe('anthropic');
  });

  it('accepts either provider, case-insensitively', () => {
    expect(resolveProviderName({ [PROVIDER_ENV_VAR]: 'bedrock' })).toBe('bedrock');
    expect(resolveProviderName({ [PROVIDER_ENV_VAR]: 'Bedrock' })).toBe('bedrock');
    expect(resolveProviderName({ [PROVIDER_ENV_VAR]: ' ANTHROPIC ' })).toBe('anthropic');
  });

  it('refuses a name it does not recognise rather than falling back', () => {
    // A deployment that typed "bedrok" meant Bedrock. Silently serving it
    // Anthropic — over the internet, from an account that may have intended
    // never to leave itself — is the outcome worth refusing to boot for.
    expect(() => resolveProviderName({ [PROVIDER_ENV_VAR]: 'bedrok' })).toThrow(/bedrok/);
    expect(() => resolveProviderName({ [PROVIDER_ENV_VAR]: 'bedrok' })).toThrow(
      /anthropic, bedrock/,
    );
  });
});

describe('resolveSopProviderConfig', () => {
  it('reads an Anthropic key and an optional model', () => {
    expect(resolveSopProviderConfig({ ANTHROPIC_API_KEY: 'sk-test' })).toEqual({
      provider: 'anthropic',
      apiKey: 'sk-test',
    });

    expect(
      resolveSopProviderConfig({ ANTHROPIC_API_KEY: 'sk-test', [MODEL_ENV_VAR]: 'claude-opus-5' }),
    ).toEqual({ provider: 'anthropic', apiKey: 'sk-test', model: 'claude-opus-5' });
  });

  it('omits an absent key rather than carrying an empty string', () => {
    // The factory distinguishes "not configured" from "configured as blank"
    // only if this does not manufacture the second from the first.
    expect(resolveSopProviderConfig({})).toEqual({ provider: 'anthropic' });
    expect(resolveSopProviderConfig({ ANTHROPIC_API_KEY: '  ' })).toEqual({
      provider: 'anthropic',
    });
  });

  it('does not read an Anthropic key when Bedrock is selected', () => {
    const config = resolveSopProviderConfig({
      [PROVIDER_ENV_VAR]: 'bedrock',
      ANTHROPIC_API_KEY: 'sk-test',
      AWS_REGION: 'us-east-1',
    });

    expect(config).toEqual({ provider: 'bedrock', region: 'us-east-1' });
    expect(config).not.toHaveProperty('apiKey');
  });

  it('prefers an explicit Orbit region over an inherited AWS one', () => {
    expect(
      resolveSopProviderConfig({
        [PROVIDER_ENV_VAR]: 'bedrock',
        ORBIT_BEDROCK_REGION: 'eu-west-1',
        AWS_REGION: 'us-east-1',
      }),
    ).toEqual({ provider: 'bedrock', region: 'eu-west-1' });
  });

  it('falls back through the standard AWS region variables, in order', () => {
    expect(BEDROCK_REGION_ENV_VARS).toEqual([
      'ORBIT_BEDROCK_REGION',
      'AWS_REGION',
      'AWS_DEFAULT_REGION',
    ]);

    expect(
      resolveSopProviderConfig({
        [PROVIDER_ENV_VAR]: 'bedrock',
        AWS_DEFAULT_REGION: 'ap-southeast-2',
      }),
    ).toEqual({ provider: 'bedrock', region: 'ap-southeast-2' });
  });

  it('returns a Bedrock config with no region rather than throwing', () => {
    // Same rule as a missing API key: this is not a reason to refuse to boot.
    // The factory turns it into a provider that fails on the one route needing
    // a model, and says which variable to set.
    expect(resolveSopProviderConfig({ [PROVIDER_ENV_VAR]: 'bedrock' })).toEqual({
      provider: 'bedrock',
    });
  });

  it('carries a Bedrock model id through', () => {
    expect(
      resolveSopProviderConfig({
        [PROVIDER_ENV_VAR]: 'bedrock',
        AWS_REGION: 'us-east-1',
        [MODEL_ENV_VAR]: 'us.anthropic.claude-haiku-4-5',
      }),
    ).toEqual({
      provider: 'bedrock',
      region: 'us-east-1',
      model: 'us.anthropic.claude-haiku-4-5',
    });
  });
});
