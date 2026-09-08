import { createChatModel, type ModelResolution, type ModelSelection } from '@orbit/model-provider';
import { z } from 'zod';

import {
  AssistProviderError,
  createUnconfiguredAssistProvider,
  type AssistProvider,
  type DriftRanking,
  type DriftRankingRequest,
  type SemanticCheckRequest,
  type SemanticCheckVerdict,
} from './provider';

/**
 * The advisory provider, over whichever model the deployment selected.
 *
 * This is the only file in the package that reaches a model, and a test asserts
 * it stays that way. It used to construct a `ChatAnthropic` itself and default
 * to Sonnet — the one call site `LLM_PROVIDER` would have missed, and the one
 * paying for a larger model than its job needs. Both are fixed here: the client
 * comes from @orbit/model-provider (ADR-034), and the model is the deployment's
 * one choice rather than this file's.
 *
 * It reads a fingerprint and a step's stated purpose and says whether they look
 * like they belong together. It never sees a page, never fetches anything, and
 * never returns something that is applied automatically. The strongest thing it
 * can do is make a human look twice.
 */

const semanticVerdictSchema = z.object({
  plausible: z.boolean(),
  reason: z.string().min(1),
});

const driftRankingSchema = z.object({
  bestIndex: z.number().int().nonnegative().nullable(),
  reason: z.string().min(1),
});

const SYSTEM_PROMPT = `You review one step of a business workflow that a person has just mapped to an element on a web page.

You are advisory. Nothing you say is applied automatically, and you never decide whether a workflow runs. Your job is to make a person look twice when something appears wrong, and to stay quiet when it does not.

You are given what the step says it does, and what the element is according to the page's accessibility tree — its role, its accessible name, and its visible text. You never see the page itself and cannot inspect anything further.

Judge only whether the element plausibly matches the described intent. A "Search" button for a step about searching is plausible. A "Delete account" button for a step about searching is not. Be slow to raise a false alarm: a step described loosely is normal, and wording rarely matches exactly. Say so plainly when something looks fine.`;

export interface ChatAssistProviderOptions {
  readonly maxRetries?: number;
}

function describeFingerprint(fingerprint: {
  readonly role: string | null;
  readonly accessibleName: string | null;
  readonly text: string | null;
}): string {
  return [
    `role: ${fingerprint.role ?? 'unknown'}`,
    `accessible name: ${fingerprint.accessibleName ?? 'none'}`,
    `visible text: ${fingerprint.text ?? 'none'}`,
  ].join('\n');
}

export function createChatAssistProvider(
  selection: ModelSelection,
  options: ChatAssistProviderOptions = {},
): AssistProvider {
  const chat = createChatModel(selection, {
    temperature: 0,
    maxRetries: options.maxRetries ?? 1,
  });

  const semantic = chat.bindSchema(semanticVerdictSchema, 'semantic_verdict');
  const drift = chat.bindSchema(driftRankingSchema, 'drift_ranking');

  /**
   * A reply that did not satisfy the schema is no advice.
   *
   * Every call in Orbit now sets `includeRaw`, so an unsatisfied schema arrives
   * as `parsed: undefined` rather than as a throw. For drafting that is the
   * repair loop's opening; here there is nothing to repair, and advice that
   * cannot be trusted is worth exactly as much as advice that never arrived.
   */
  function required<T>(parsed: T | undefined): T {
    if (parsed === undefined || parsed === null) {
      throw new AssistProviderError('The advisory model did not answer in the required shape.');
    }

    return parsed;
  }

  return {
    descriptor: chat.descriptor,

    async checkSemanticMatch(request: SemanticCheckRequest): Promise<SemanticCheckVerdict> {
      try {
        const response = await semantic.invoke([
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `The step is a "${request.stepKind}" step, described as: ${request.stepPurpose}\n\nThe element recorded for it:\n${describeFingerprint(request.fingerprint)}`,
          },
        ]);

        return required(response.parsed);
      } catch (error) {
        if (error instanceof AssistProviderError) {
          throw error;
        }

        throw new AssistProviderError(
          error instanceof Error
            ? `The advisory model could not be reached: ${error.message}`
            : 'The advisory model could not be reached.',
          { cause: error },
        );
      }
    },

    async rankDriftCandidates(request: DriftRankingRequest): Promise<DriftRanking> {
      try {
        const listed = request.candidates
          .map((candidate) => `[${candidate.index}]\n${describeFingerprint(candidate.fingerprint)}`)
          .join('\n\n');

        const response = await drift.invoke([
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `A workflow stopped because the page no longer matches what was approved for this step: ${request.stepPurpose}\n\nThe element it expected:\n${describeFingerprint(request.expected)}\n\nElements on the page now:\n${listed}\n\nWhich one, if any, is the same control? Answer with its index, or null if none of them is.`,
          },
        ]);

        return required(response.parsed);
      } catch (error) {
        if (error instanceof AssistProviderError) {
          throw error;
        }

        throw new AssistProviderError(
          error instanceof Error
            ? `The advisory model could not be reached: ${error.message}`
            : 'The advisory model could not be reached.',
          { cause: error },
        );
      }
    },
  };
}

/**
 * The advisory provider, or one that reports why there is none.
 *
 * Advice is optional by definition, so an unconfigured deployment degrades the
 * recorder to "no suggestions" rather than breaking it — the null object is
 * production behaviour, not a test double.
 */
export function createAssistProvider(resolution: ModelResolution): AssistProvider {
  if (resolution.status === 'unconfigured') {
    return createUnconfiguredAssistProvider(
      `${resolution.reason} Recording assists are unavailable; everything else in the recorder works.`,
    );
  }

  return createChatAssistProvider(resolution.selection);
}
