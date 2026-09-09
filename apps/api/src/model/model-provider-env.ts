import { resolveModelSelection, type ModelResolution } from '@orbit/model-provider';

/**
 * The API's half of model configuration: read the environment, hand over a value.
 *
 * There is almost nothing left in this file, and that is the change. It used to
 * hold the provider vocabulary, the credential lookup, the region lookup and
 * the defaulting — all of which the browser worker and the recorder each had
 * their own version of, so `ORBIT_LLM_PROVIDER` moved drafting and left judged
 * decisions and authoring advice wherever they were. @orbit/model-provider owns
 * all of it now (ADR-034); this is the entry point's remaining job, which is to
 * be the thing that touches `process.env` so library code never does.
 *
 * It sits beside `model-budget-env.ts` and `env.ts` for that reason.
 */
export function resolveApiModelSelection(env: NodeJS.ProcessEnv = process.env): ModelResolution {
  return resolveModelSelection(env);
}
