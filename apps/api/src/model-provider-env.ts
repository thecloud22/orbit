import {
  DEFAULT_MODEL_PROVIDER,
  isModelProviderName,
  MODEL_PROVIDER_NAMES,
  type SopProviderConfig,
} from '@orbit/sop-generation';

/**
 * Which model provider this deployment uses, read from the environment.
 *
 * Library code never reads the environment; only entry points do. This sits
 * beside `model-budget-env.ts` and `env.ts` for that reason, and the factory it
 * feeds takes a value rather than reaching for a global.
 *
 * Naming: the existing family is `ORBIT_LLM_*` (`ORBIT_LLM_MODEL`,
 * `ORBIT_LLM_TOKEN_BUDGET_*`, `ORBIT_LLM_RATES_USD_PER_MTOK`), so the provider
 * switch is `ORBIT_LLM_PROVIDER` rather than a new `ORBIT_MODEL_*` prefix that
 * would leave a reader guessing which of two families a variable belongs to.
 */

export const PROVIDER_ENV_VAR = 'ORBIT_LLM_PROVIDER';
export const MODEL_ENV_VAR = 'ORBIT_LLM_MODEL';

/**
 * The Bedrock region.
 *
 * `AWS_REGION` first, because that is the variable an AWS deployment already
 * has set and the one every other AWS tool in the account reads.
 * `ORBIT_BEDROCK_REGION` is an override for the case where Orbit must call a
 * different region than the rest of the process, and is checked first so that
 * an explicit choice beats an inherited one.
 */
export const BEDROCK_REGION_ENV_VARS = ['ORBIT_BEDROCK_REGION', 'AWS_REGION', 'AWS_DEFAULT_REGION'];

function trimmed(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result === undefined || result === '' ? undefined : result;
}

/**
 * Reads the provider name.
 *
 * An unrecognised value throws rather than falling back to the default. A
 * deployment that typed `ORBIT_LLM_PROVIDER=bedrok` meant Bedrock, and silently
 * serving it Anthropic — quite possibly over the internet, from inside an
 * account that intended never to leave itself — is the one outcome worth
 * refusing to boot for. This mirrors `readTokenBudget`, which refuses a
 * mistyped ceiling for the same reason.
 */
export function resolveProviderName(env: NodeJS.ProcessEnv = process.env): string {
  const raw = trimmed(env[PROVIDER_ENV_VAR]);

  if (raw === undefined) {
    return DEFAULT_MODEL_PROVIDER;
  }

  const value = raw.toLowerCase();

  if (!isModelProviderName(value)) {
    throw new Error(
      `${PROVIDER_ENV_VAR} must be one of ${MODEL_PROVIDER_NAMES.join(', ')}. Got "${raw}".`,
    );
  }

  return value;
}

export function resolveSopProviderConfig(env: NodeJS.ProcessEnv = process.env): SopProviderConfig {
  const provider = resolveProviderName(env);
  const model = trimmed(env[MODEL_ENV_VAR]);

  if (provider === 'bedrock') {
    const region = BEDROCK_REGION_ENV_VARS.map((name) => trimmed(env[name])).find(
      (value) => value !== undefined,
    );

    return {
      provider: 'bedrock',
      ...(region === undefined ? {} : { region }),
      ...(model === undefined ? {} : { model }),
    };
  }

  const apiKey = trimmed(env['ANTHROPIC_API_KEY']);

  return {
    provider: 'anthropic',
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(model === undefined ? {} : { model }),
  };
}
