import { ChatAnthropic } from '@langchain/anthropic';
import { z } from 'zod';

import {
  AssistProviderError,
  type AssistProvider,
  type DriftRanking,
  type DriftRankingRequest,
  type SemanticCheckRequest,
  type SemanticCheckVerdict,
} from './provider';

/**
 * The Anthropic-backed advisory provider.
 *
 * This is the only file in the package that imports a model client, and a test
 * asserts it stays that way — the same isolation @orbit/sop-generation's
 * `anthropic-provider.ts` keeps.
 *
 * It reads a fingerprint and a step's stated purpose and says whether they look
 * like they belong together. It never sees a page, never fetches anything, and
 * never returns something that is applied automatically. The strongest thing it
 * can do is make a human look twice.
 */

export const ANTHROPIC_ASSIST_PROVIDER = 'anthropic';
export const DEFAULT_ASSIST_MODEL = 'claude-sonnet-5';

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

export interface AnthropicAssistProviderOptions {
  readonly apiKey: string;
  readonly model?: string;
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

export function createAnthropicAssistProvider(
  options: AnthropicAssistProviderOptions,
): AssistProvider {
  const model = options.model ?? DEFAULT_ASSIST_MODEL;

  const chat = new ChatAnthropic({
    apiKey: options.apiKey,
    model,
    temperature: 0,
    maxRetries: options.maxRetries ?? 1,
  });

  const semantic = chat.withStructuredOutput<z.infer<typeof semanticVerdictSchema>>(
    semanticVerdictSchema,
    { name: 'semantic_verdict' },
  );

  const drift = chat.withStructuredOutput<z.infer<typeof driftRankingSchema>>(driftRankingSchema, {
    name: 'drift_ranking',
  });

  return {
    descriptor: { provider: ANTHROPIC_ASSIST_PROVIDER, model },

    async checkSemanticMatch(request: SemanticCheckRequest): Promise<SemanticCheckVerdict> {
      try {
        return await semantic.invoke([
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `The step is a "${request.stepKind}" step, described as: ${request.stepPurpose}\n\nThe element recorded for it:\n${describeFingerprint(request.fingerprint)}`,
          },
        ]);
      } catch (error) {
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

        return await drift.invoke([
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `A workflow stopped because the page no longer matches what was approved for this step: ${request.stepPurpose}\n\nThe element it expected:\n${describeFingerprint(request.expected)}\n\nElements on the page now:\n${listed}\n\nWhich one, if any, is the same control? Answer with its index, or null if none of them is.`,
          },
        ]);
      } catch (error) {
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
