import { ChatBedrockConverse } from '@langchain/aws';

import { sopGraphProposalSchema, type SopGraphProposal } from './proposal';
import { buildGenerationMessage, SOP_GENERATION_SYSTEM_PROMPT } from './prompt';
import { unvalidatedArguments, usageOf } from './structured-response';
import {
  SopProviderError,
  type LLMProvider,
  type SopGraphProposalRequest,
  type SopGraphProposalResponse,
} from './provider';

/**
 * The same Claude models, reached through Amazon Bedrock.
 *
 * This exists because a deployment inside an AWS account usually cannot call
 * api.anthropic.com at all — not as a preference but as a network fact — and
 * "which company's endpoint" is not a question the drafting pipeline should
 * have an opinion about. It satisfies the identical `LLMProvider` contract,
 * including token-usage reporting, so the spend ledger and all three budget
 * scopes behave the same whichever provider is configured. Nothing downstream
 * of `LLMProvider` knows which one it got.
 *
 * **Credentials are not Orbit's business.** There is deliberately no
 * `accessKeyId`/`secretAccessKey` option here and no Orbit-specific variable
 * for one. `ChatBedrockConverse` falls through to the AWS SDK's default
 * credential provider chain — environment variables, a shared profile, SSO, an
 * EC2/ECS/EKS instance role, IRSA — which is the mechanism every other tool in
 * an AWS account already uses. Inventing a bespoke scheme beside it would mean
 * a second place secrets could be typed, and CLAUDE.md's rule is that Orbit
 * never holds one.
 *
 * **Untested against real AWS.** There are no AWS credentials in the
 * environment this was written in, so its correctness is structural — the
 * contract, the wiring, and the error path are covered by tests against a
 * stubbed model; that a real Bedrock call returns what this expects is not
 * something this repository has demonstrated. Treat the first real call as the
 * test.
 */

export const BEDROCK_PROVIDER_NAME = 'bedrock';

/**
 * Bedrock names the same model differently.
 *
 * Bedrock model ids carry an `anthropic.` prefix, and a region-scoped
 * deployment usually carries a geography prefix on top of that (`us.` /
 * `eu.` / `apac.` for a cross-region inference profile). Which one is right
 * depends on the account, so this default is the plain form and the id is
 * configurable — Orbit cannot know which inference profiles an account has.
 */
export const DEFAULT_BEDROCK_SOP_GENERATION_MODEL = 'anthropic.claude-haiku-4-5';

export interface BedrockSopProviderOptions {
  /** An AWS region, e.g. `us-east-1`. Required: Bedrock is region-scoped. */
  readonly region: string;
  readonly model?: string;
  /** Deterministic by default; this is extraction, not composition. */
  readonly temperature?: number;
  readonly maxRetries?: number;
}

export function createBedrockSopProvider(options: BedrockSopProviderOptions): LLMProvider {
  const model = options.model ?? DEFAULT_BEDROCK_SOP_GENERATION_MODEL;

  // No `credentials` argument on purpose — see the note above. Omitting it is
  // what hands resolution to the AWS default credential provider chain.
  const chat = new ChatBedrockConverse({
    model,
    region: options.region,
    temperature: options.temperature ?? 0,
    maxRetries: options.maxRetries ?? 2,
  });

  const structured = chat.withStructuredOutput<SopGraphProposal>(sopGraphProposalSchema, {
    name: 'sop_graph_proposal',
    includeRaw: true,
  });

  return {
    descriptor: { provider: BEDROCK_PROVIDER_NAME, model },

    async generateSopGraphProposal(
      request: SopGraphProposalRequest,
    ): Promise<SopGraphProposalResponse> {
      try {
        const response = await structured.invoke([
          { role: 'system', content: SOP_GENERATION_SYSTEM_PROMPT },
          {
            role: 'user',
            content: buildGenerationMessage(request.sourceText, request.repairContext),
          },
        ]);

        return { proposal: unvalidatedArguments(response), usage: usageOf(response.raw) };
      } catch (error) {
        // Identical handling to the Anthropic provider, and identical for the
        // same reason: the pipeline converts exactly one error type into a
        // provider failure. A missing credential, an unavailable region and a
        // model an account has no access to all arrive here, and all of them
        // are this provider failing to produce a proposal.
        throw new SopProviderError(
          error instanceof Error
            ? `The model provider could not generate a proposal: ${error.message}`
            : 'The model provider could not generate a proposal.',
          { provider: BEDROCK_PROVIDER_NAME, cause: error },
        );
      }
    },
  };
}
