import type { ModelResolution } from '@orbit/model-provider';

import { createChatSopProvider } from './chat-provider';
import { createUnconfiguredSopProvider, type LLMProvider } from './provider';

/**
 * Turns a resolved model selection into a drafting provider.
 *
 * This used to decide *which* provider to build. It no longer does: the choice
 * of family and invocation is one question for the whole application and
 * @orbit/model-provider answers it (ADR-034), so what is left here is the part
 * that is genuinely drafting's own — what happens when nothing is configured,
 * and how that reads to the person who has to fix it.
 *
 * **Nothing here reads `process.env`.** Library code takes configuration; entry
 * points read environments. `apps/api/src/model-provider-env.ts` is the entry
 * point's half, exactly as `model-budget-env.ts` is for budgets.
 *
 * **No test double is reachable from here.** The deterministic fake still lives
 * behind `@orbit/sop-generation/testing` and this factory has no import path to
 * it; `apps/api/src/sop-provider-boundary.test.ts` proves that transitively
 * from the shipped entry point. Configuration selecting between two real
 * providers is not the hazard that guard exists for — selecting a fake in
 * production is.
 */
export function createSopProvider(resolution: ModelResolution): LLMProvider {
  if (resolution.status === 'unconfigured') {
    // Returned rather than thrown, and that behaviour is the point rather than
    // an accident: a deployment with no model configured still boots, every
    // route that does not need a model still works, and the one route that does
    // says exactly what is missing. The reason names the variable, because the
    // person reading it is looking at a browser rather than at this file.
    return createUnconfiguredSopProvider(
      `${resolution.reason} SOP generation is unavailable. See README > SOP drafting.`,
    );
  }

  return createChatSopProvider(resolution.selection);
}
