import { createChatModel, usageOf, type ModelSelection } from '@orbit/model-provider';

import { sopGraphProposalSchema, type SopGraphProposal } from './proposal';
import { buildGenerationMessage, SOP_GENERATION_SYSTEM_PROMPT } from './prompt';
import { unvalidatedArguments } from './structured-response';
import {
  SopProviderError,
  type LLMProvider,
  type SopGraphProposalRequest,
  type SopGraphProposalResponse,
} from './provider';

/**
 * The drafting provider, over whichever model the deployment selected.
 *
 * There were two of these — one for Anthropic, one for Bedrock — and they were
 * the same file with a different constructor at the top. Both are gone: which
 * family, reached how, with which credentials is @orbit/model-provider's
 * question now, and this file is what remains once that question is somebody
 * else's (ADR-034). It is the only module here that can reach a model at all,
 * and a test asserts that.
 *
 * What did *not* move is the contract. `LLMProvider` still returns a proposal
 * and its token usage, the pipeline still validates and repairs, and nothing
 * downstream knows which provider produced the reply. That separation is the
 * reason a third family costs one branch in one package rather than a file
 * here, a file in the judge, and a file in assist.
 */
export function createChatSopProvider(
  selection: ModelSelection,
  options: { readonly temperature?: number; readonly maxRetries?: number } = {},
): LLMProvider {
  const chat = createChatModel(selection, {
    // Deterministic by default; this is extraction, not composition.
    temperature: options.temperature ?? 0,
    maxRetries: options.maxRetries ?? 2,
  });

  const call = chat.bindSchema<SopGraphProposal>(sopGraphProposalSchema, 'sop_graph_proposal');

  return {
    descriptor: chat.descriptor,

    async generateSopGraphProposal(
      request: SopGraphProposalRequest,
    ): Promise<SopGraphProposalResponse> {
      try {
        const response = await call.invoke([
          { role: 'system', content: SOP_GENERATION_SYSTEM_PROMPT },
          {
            role: 'user',
            content: buildGenerationMessage(request.sourceText, request.repairContext),
          },
        ]);

        return { proposal: unvalidatedArguments(response), usage: usageOf(response.raw) };
      } catch (error) {
        // Wrapped, never re-thrown bare: the pipeline converts exactly one
        // error type into a provider failure, and the original is kept as the
        // cause so the API can log it without ever serializing it. A missing
        // credential, an unavailable region, and a model an account has no
        // access to all arrive here, and all of them are this provider failing
        // to produce a proposal.
        throw new SopProviderError(
          error instanceof Error
            ? `The model provider could not generate a proposal: ${error.message}`
            : 'The model provider could not generate a proposal.',
          { provider: chat.descriptor.provider, cause: error },
        );
      }
    },
  };
}
