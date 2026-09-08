import { createAnthropicSopProvider } from './anthropic-provider';
import { createBedrockSopProvider } from './bedrock-provider';
import { createUnconfiguredSopProvider, type LLMProvider } from './provider';

/**
 * Which real provider to build, from configuration that has already been read.
 *
 * This is a factory in front of `LLMProvider`, not a new abstraction. The
 * interface was already the seam — a provider turns source text into whatever
 * the model produced — and the only thing missing was somewhere to decide which
 * implementation satisfies it. That decision lives here, in one place, rather
 * than in the API entry point where it would be re-made by every future entry
 * point that needs a model.
 *
 * **Nothing here reads `process.env`.** Library code takes configuration; entry
 * points read environments. `apps/api/src/model-provider-env.ts` is the entry
 * point's half, exactly as `model-budget-env.ts` is for budgets. That split is
 * what lets every branch below be tested by passing a value rather than by
 * mutating a global.
 *
 * **No test double is reachable from here.** The deterministic fake still lives
 * behind `@orbit/sop-generation/testing` and this factory has no import path to
 * it; `apps/api/src/sop-provider-boundary.test.ts` proves that transitively
 * from the shipped entry point. Selecting between two real providers is not the
 * hazard that guard exists for — selecting a fake in production is.
 */

export const MODEL_PROVIDER_NAMES = ['anthropic', 'bedrock'] as const;
export type ModelProviderName = (typeof MODEL_PROVIDER_NAMES)[number];

export const DEFAULT_MODEL_PROVIDER: ModelProviderName = 'anthropic';

export function isModelProviderName(value: string): value is ModelProviderName {
  return (MODEL_PROVIDER_NAMES as readonly string[]).includes(value);
}

/**
 * What a deployment has configured.
 *
 * A discriminated union rather than one bag of optional fields, so a Bedrock
 * deployment cannot be handed an API key and an Anthropic one cannot be handed
 * a region and have it silently ignored.
 */
export type SopProviderConfig =
  | {
      readonly provider: 'anthropic';
      /** Absent when the deployment set no key. Not a failure to boot. */
      readonly apiKey?: string;
      readonly model?: string;
    }
  | {
      readonly provider: 'bedrock';
      /** Absent when the deployment set no region. Not a failure to boot. */
      readonly region?: string;
      readonly model?: string;
    };

/**
 * Builds the configured provider, or one that fails clearly when asked.
 *
 * Missing configuration returns `createUnconfiguredSopProvider` rather than
 * throwing, and that behaviour is the point rather than an accident of this
 * refactor: a deployment with no model configured still boots, every route that
 * does not need a model still works, and the one route that does says exactly
 * what is missing and how to supply it. A process that refuses to start takes
 * every unrelated evidence lookup down with it over a feature nobody was using.
 *
 * The reason string names the variable, because the person reading it is
 * looking at a browser rather than at this file.
 */
export function createSopProvider(config: SopProviderConfig): LLMProvider {
  if (config.provider === 'bedrock') {
    const region = config.region?.trim();

    if (region === undefined || region === '') {
      return createUnconfiguredSopProvider(
        'ORBIT_LLM_PROVIDER is set to "bedrock" but no AWS region is configured, so SOP ' +
          'generation is unavailable. Set AWS_REGION (or ORBIT_BEDROCK_REGION). ' +
          'See README > SOP drafting.',
      );
    }

    return createBedrockSopProvider({
      region,
      ...(config.model === undefined || config.model.trim() === ''
        ? {}
        : { model: config.model.trim() }),
    });
  }

  const apiKey = config.apiKey?.trim();

  if (apiKey === undefined || apiKey === '') {
    return createUnconfiguredSopProvider(
      'ANTHROPIC_API_KEY is not set, so SOP generation is unavailable. See README > SOP drafting.',
    );
  }

  return createAnthropicSopProvider({
    apiKey,
    ...(config.model === undefined || config.model.trim() === ''
      ? {}
      : { model: config.model.trim() }),
  });
}
