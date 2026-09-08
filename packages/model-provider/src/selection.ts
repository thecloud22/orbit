/**
 * Which model a deployment uses, and how it is reached.
 *
 * Two questions, kept apart on purpose (ADR-034):
 *
 *   **family**     — whose models: `anthropic` or `gemini`.
 *   **invocation** — how they are reached: `direct` or through `bedrock`.
 *
 * They were one question until now, and that was the defect. `ORBIT_LLM_PROVIDER`
 * accepted `anthropic | bedrock`, which reads as a choice of vendor but is
 * really a choice of vendor *and* transport welded together — so "the same
 * models, reached differently in production" had no spelling, and a second
 * family had nowhere to go. Splitting them is what makes the deployment story
 * work: a laptop runs `anthropic` + `direct`, the same build in an AWS account
 * runs `anthropic` + `bedrock`, and no application code knows the difference.
 *
 * One combination does not exist. Bedrock does not serve Gemini, so
 * `gemini` + `bedrock` is refused here, at resolution, with a message naming
 * the problem — rather than at the first model call, hours later, as an opaque
 * "model not found" from someone else's API.
 *
 * **Nothing in this file reads `process.env`.** Every function takes the
 * environment as an argument and there is no default parameter reaching for a
 * global, which is the same rule `parseModelRates` follows: library code takes
 * configuration, entry points read environments. It is also what lets every
 * branch below be tested by passing a record rather than by mutating a global.
 */

export const MODEL_FAMILIES = ['anthropic', 'gemini'] as const;
export type ModelFamily = (typeof MODEL_FAMILIES)[number];

export const INVOCATION_MODES = ['direct', 'bedrock'] as const;
export type InvocationMode = (typeof INVOCATION_MODES)[number];

export const DEFAULT_MODEL_FAMILY: ModelFamily = 'anthropic';

/**
 * Direct by default.
 *
 * The default is what a developer with a fresh checkout gets, and that person
 * has an API key rather than an AWS account. A deployment sets `LLM_INVOCATION`
 * the way it sets a database URL — as part of the environment it runs in.
 */
export const DEFAULT_INVOCATION_MODE: InvocationMode = 'direct';

export const FAMILY_ENV_VAR = 'LLM_PROVIDER';
export const INVOCATION_ENV_VAR = 'LLM_INVOCATION';

export const ANTHROPIC_KEY_ENV_VAR = 'ANTHROPIC_API_KEY';
export const ANTHROPIC_MODEL_ENV_VAR = 'ANTHROPIC_MODEL';

export const GEMINI_KEY_ENV_VARS = ['GEMINI_API_KEY', 'GOOGLE_API_KEY'] as const;
export const GEMINI_MODEL_ENV_VAR = 'GEMINI_MODEL';

/**
 * The Bedrock region.
 *
 * `ORBIT_BEDROCK_REGION` first so an explicit choice beats an inherited one,
 * then the variables an AWS deployment already has set. There is deliberately
 * no Orbit variable for an access key: `ChatBedrockConverse` resolves
 * credentials through the AWS SDK's default provider chain — environment,
 * shared profile, SSO, instance role, IRSA — and a bespoke scheme beside it
 * would be a second place a secret could be typed.
 */
export const BEDROCK_REGION_ENV_VARS = [
  'ORBIT_BEDROCK_REGION',
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
] as const;

/** Superseded names, still honoured. See `readDeprecatedAliases`. */
export const DEPRECATED_PROVIDER_ENV_VAR = 'ORBIT_LLM_PROVIDER';
export const DEPRECATED_MODEL_ENV_VAR = 'ORBIT_LLM_MODEL';

/**
 * The cheapest current model of each family, per invocation.
 *
 * Every call site in Orbit is bounded structured extraction behind a strict
 * schema — a proposal that is validated, an index into a closed list, an
 * advisory verdict nothing auto-applies. What makes those trustworthy is the
 * validator, not model size, so the default is the cheap one and a larger model
 * is a purchase a deployment makes deliberately.
 *
 * Bedrock names the same Claude models differently (an `anthropic.` prefix, and
 * a geography prefix on top of that for a cross-region inference profile),
 * which is why the default is keyed by both axes rather than by family alone.
 *
 * Gemini's entry is `gemini-2.5-flash-lite`: Google's cheapest generally
 * available model that still supports function calling, which is what
 * structured output is built on — the Flash-Lite tier is roughly a tenth of
 * Flash's output rate. Model availability changes faster than this file does,
 * so it is one variable to override.
 */
export const DEFAULT_MODELS: Readonly<Record<`${ModelFamily}:${InvocationMode}`, string>> = {
  'anthropic:direct': 'claude-haiku-4-5',
  'anthropic:bedrock': 'anthropic.claude-haiku-4-5',
  'gemini:direct': 'gemini-2.5-flash-lite',
  // Present so the record is total and the type has no hole. It is never
  // reached: `resolveModelSelection` refuses the combination first.
  'gemini:bedrock': 'unsupported',
};

/** Every model id that can be selected without setting a model variable. */
export const DEFAULT_MODEL_IDS: readonly string[] = [
  DEFAULT_MODELS['anthropic:direct'],
  DEFAULT_MODELS['anthropic:bedrock'],
  DEFAULT_MODELS['gemini:direct'],
];

/**
 * A resolved, complete choice. Everything needed to construct a client.
 *
 * `model` is never undefined here: defaulting happens during resolution, so
 * every consumer, ledger row and rate lookup sees the same concrete id rather
 * than each re-deriving one.
 */
export interface ModelSelection {
  readonly family: ModelFamily;
  readonly invocation: InvocationMode;
  readonly model: string;
  /** Direct invocation only. Never logged, never persisted. */
  readonly apiKey?: string;
  /** Bedrock invocation only. */
  readonly region?: string;
}

/**
 * What resolution produced.
 *
 * `unconfigured` is a value rather than an exception, and that is the whole
 * point: a deployment with no model configured still boots, every route that
 * does not need a model still works, and the one route that does says exactly
 * what is missing. A process that refuses to start takes every unrelated
 * evidence lookup down with it over a feature nobody was using.
 *
 * A *mistyped* variable is the opposite case and throws — see
 * `resolveModelSelection`.
 */
export type ModelResolution =
  | {
      readonly status: 'configured';
      readonly selection: ModelSelection;
      readonly deprecations: readonly string[];
    }
  | {
      readonly status: 'unconfigured';
      /** Names the missing variable. Callers append the feature it disables. */
      readonly reason: string;
      readonly deprecations: readonly string[];
    };

export interface ModelResolutionOptions {
  /**
   * A per-call-site model, from that site's own variable.
   *
   * Wins over the family's model variable, which wins over the default. The
   * judge has one of these (`ORBIT_LLM_DECISION_MODEL`) because a decision that
   * runs on every execution may want a different cost profile from drafting.
   */
  readonly modelOverride?: string;
}

function trimmed(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result === undefined || result === '' ? undefined : result;
}

function firstOf(
  env: Readonly<Record<string, string | undefined>>,
  names: readonly string[],
): string | undefined {
  for (const name of names) {
    const value = trimmed(env[name]);

    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function isModelFamily(value: string): value is ModelFamily {
  return (MODEL_FAMILIES as readonly string[]).includes(value);
}

function isInvocationMode(value: string): value is InvocationMode {
  return (INVOCATION_MODES as readonly string[]).includes(value);
}

interface Axes {
  readonly family: ModelFamily;
  readonly invocation: InvocationMode;
  readonly deprecations: readonly string[];
}

/**
 * Honours the superseded `ORBIT_LLM_*` names.
 *
 * `ORBIT_LLM_PROVIDER` took `anthropic | bedrock` — one variable holding both
 * axes — so the alias translates rather than copies: `bedrock` there meant
 * Claude models reached through Bedrock, which is now `anthropic` + `bedrock`.
 * A working `.env` therefore keeps working and means exactly what it meant
 * before, which is the only reason to accept an alias at all.
 *
 * The new names win when both are set. A deployment that has adopted the new
 * spelling has said so more recently, and silently preferring the old one would
 * make migration a thing you cannot finish.
 */
function readAxes(env: Readonly<Record<string, string | undefined>>): Axes {
  const deprecations: string[] = [];

  const legacyProvider = trimmed(env[DEPRECATED_PROVIDER_ENV_VAR])?.toLowerCase();
  let legacyFamily: ModelFamily | undefined;
  let legacyInvocation: InvocationMode | undefined;

  if (legacyProvider !== undefined) {
    if (legacyProvider === 'bedrock') {
      legacyFamily = 'anthropic';
      legacyInvocation = 'bedrock';
    } else if (legacyProvider === 'anthropic') {
      legacyFamily = 'anthropic';
      legacyInvocation = 'direct';
    } else {
      throw new Error(
        `${DEPRECATED_PROVIDER_ENV_VAR} (deprecated) accepts only "anthropic" or "bedrock". ` +
          `Got "${legacyProvider}". Use ${FAMILY_ENV_VAR}=${MODEL_FAMILIES.join('|')} and ` +
          `${INVOCATION_ENV_VAR}=${INVOCATION_MODES.join('|')} instead.`,
      );
    }

    deprecations.push(
      `${DEPRECATED_PROVIDER_ENV_VAR} is deprecated. It set ${FAMILY_ENV_VAR}=${legacyFamily} ` +
        `and ${INVOCATION_ENV_VAR}=${legacyInvocation}; set those two directly instead.`,
    );
  }

  const rawFamily = trimmed(env[FAMILY_ENV_VAR])?.toLowerCase();

  if (rawFamily !== undefined && !isModelFamily(rawFamily)) {
    // Throws rather than falling back to the default. A deployment that typed
    // `gemni` meant Gemini, and silently serving it Anthropic — quite possibly
    // billing an account it never intended to use — is the one outcome worth
    // refusing to boot for.
    throw new Error(
      `${FAMILY_ENV_VAR} must be one of ${MODEL_FAMILIES.join(', ')}. Got "${rawFamily}".`,
    );
  }

  const rawInvocation = trimmed(env[INVOCATION_ENV_VAR])?.toLowerCase();

  if (rawInvocation !== undefined && !isInvocationMode(rawInvocation)) {
    throw new Error(
      `${INVOCATION_ENV_VAR} must be one of ${INVOCATION_MODES.join(', ')}. Got "${rawInvocation}".`,
    );
  }

  const family = rawFamily ?? legacyFamily ?? DEFAULT_MODEL_FAMILY;
  const invocation = rawInvocation ?? legacyInvocation ?? DEFAULT_INVOCATION_MODE;

  if (family === 'gemini' && invocation === 'bedrock') {
    // Refused here rather than at the first call. Amazon Bedrock does not serve
    // Google's models, so this configuration cannot be satisfied by anything —
    // it is a mistake in the environment, and the useful moment to say so is
    // startup, not the first drafting request of the day.
    throw new Error(
      `${FAMILY_ENV_VAR}=gemini cannot be combined with ${INVOCATION_ENV_VAR}=bedrock: ` +
        'Amazon Bedrock does not serve Gemini models. Use LLM_INVOCATION=direct with a ' +
        'GEMINI_API_KEY, or LLM_PROVIDER=anthropic to reach Claude models through Bedrock.',
    );
  }

  return { family, invocation, deprecations };
}

function readModel(
  env: Readonly<Record<string, string | undefined>>,
  axes: Axes,
  options: ModelResolutionOptions,
  deprecations: string[],
): string {
  const override = trimmed(options.modelOverride);

  if (override !== undefined) {
    return override;
  }

  const familyVariable = axes.family === 'gemini' ? GEMINI_MODEL_ENV_VAR : ANTHROPIC_MODEL_ENV_VAR;
  const configured = trimmed(env[familyVariable]);

  if (configured !== undefined) {
    return configured;
  }

  const legacy = trimmed(env[DEPRECATED_MODEL_ENV_VAR]);

  if (legacy !== undefined) {
    if (axes.family === 'gemini') {
      // Ignored rather than honoured, and said out loud. The superseded
      // variable existed when Anthropic was the only family, so every value
      // anyone has ever put in it is a Claude or Bedrock model id. Passing one
      // to Gemini would produce a "model not found" from Google's API for a
      // variable the deployment thought it had left behind.
      deprecations.push(
        `${DEPRECATED_MODEL_ENV_VAR} is deprecated and was ignored: it holds a Claude model id ` +
          `and ${FAMILY_ENV_VAR} is "gemini". Set ${GEMINI_MODEL_ENV_VAR} to choose a Gemini model.`,
      );

      return DEFAULT_MODELS['gemini:direct'];
    }

    deprecations.push(`${DEPRECATED_MODEL_ENV_VAR} is deprecated. Use ${familyVariable} instead.`);

    return legacy;
  }

  return DEFAULT_MODELS[`${axes.family}:${axes.invocation}`];
}

/**
 * Reads the whole choice out of an environment.
 *
 * Called once per entry point at startup. Three of them call it — the API for
 * drafting, the browser worker for judged decisions, the recorder for advisory
 * assists — and that is the point of this function existing: before it, each
 * call site read its own variables, so `LLM_PROVIDER` could have changed one of
 * them and left the other two on a different model.
 *
 * Throws on a mistyped or impossible configuration; returns `unconfigured` on a
 * merely absent one.
 */
export function resolveModelSelection(
  env: Readonly<Record<string, string | undefined>>,
  options: ModelResolutionOptions = {},
): ModelResolution {
  const axes = readAxes(env);
  const deprecations = [...axes.deprecations];
  const model = readModel(env, axes, options, deprecations);

  if (axes.invocation === 'bedrock') {
    const region = firstOf(env, BEDROCK_REGION_ENV_VARS);

    if (region === undefined) {
      return {
        status: 'unconfigured',
        reason:
          `${INVOCATION_ENV_VAR} is "bedrock" but no AWS region is configured. ` +
          `Set ${BEDROCK_REGION_ENV_VARS.join(' or ')}.`,
        deprecations,
      };
    }

    return {
      status: 'configured',
      selection: { family: axes.family, invocation: 'bedrock', model, region },
      deprecations,
    };
  }

  const keyVariables = axes.family === 'gemini' ? GEMINI_KEY_ENV_VARS : [ANTHROPIC_KEY_ENV_VAR];
  const apiKey = firstOf(env, keyVariables);

  if (apiKey === undefined) {
    return {
      status: 'unconfigured',
      reason: `${keyVariables[0]} is not set.`,
      deprecations,
    };
  }

  return {
    status: 'configured',
    selection: { family: axes.family, invocation: 'direct', model, apiKey },
    deprecations,
  };
}

/**
 * What the spend ledger and every `descriptor.provider` records.
 *
 * Invocation wins when it is Bedrock, which keeps the two values already in the
 * `model_usage` table — `anthropic` and `bedrock` — meaning exactly what they
 * meant before this change, so no migration and no re-interpretation of history
 * is needed. `gemini` is the only new value.
 */
export function providerLabel(selection: ModelSelection): string {
  return selection.invocation === 'bedrock' ? 'bedrock' : selection.family;
}
