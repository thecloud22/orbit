import { ChatAnthropic } from '@langchain/anthropic';
import { ChatBedrockConverse } from '@langchain/aws';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import type { z } from 'zod';

import { providerLabel, type ModelSelection } from './selection';

/**
 * The one file in Orbit that constructs a model client.
 *
 * Before this, three packages each held their own — @orbit/sop-generation for
 * drafting, @orbit/decision-judge for judged decisions,
 * @orbit/execution-assist for authoring advice — and each read its own
 * variables. That is the failure this module exists to remove: setting
 * `LLM_PROVIDER` would have switched one of them and left the other two
 * somewhere else, which is worse than not supporting a second provider at all,
 * because the ledger would still look coherent.
 *
 * What is shared is deliberately narrow: *which model family, reached how, with
 * which credentials, reporting usage in one shape*. The three domain contracts
 * are not shared and must not be — a drafting provider returns a proposal, the
 * judge returns an index, an assist returns a verdict — so each package binds
 * its own schema to the model this returns and keeps its own interface.
 *
 * LangChain is used at the model layer only: a chat model, a schema bound to
 * it, one call. No agent, no chain, no memory, no retrieval, no graph. Every
 * one of those would be a capability to take back later.
 */

export interface ChatMessage {
  readonly role: 'system' | 'user';
  readonly content: string;
}

/**
 * One structured reply.
 *
 * `raw` and `parsed` are both here because callers need both and for different
 * reasons. `parsed` is the schema-satisfying value or `undefined` when the
 * model produced something that does not satisfy it; `raw` carries the token
 * usage and, for the drafting repair loop, the model's unvalidated arguments —
 * an invalid proposal has to arrive at the validator as data rather than as a
 * thrown provider error, or no repair would ever be attempted.
 */
export interface StructuredResult<T> {
  readonly raw: unknown;
  readonly parsed: T | undefined;
}

export interface StructuredCallOptions {
  readonly timeoutMs?: number;
}

export interface StructuredCall<T> {
  invoke(
    messages: readonly ChatMessage[],
    options?: StructuredCallOptions,
  ): Promise<StructuredResult<T>>;
}

export interface OrbitChatModel {
  readonly selection: ModelSelection;
  /** What a ledger row and a `descriptor` record for calls made through this. */
  readonly descriptor: { readonly provider: string; readonly model: string };
  /** Binds a schema, giving a call that returns it. `name` is the tool name. */
  bindSchema<T>(schema: z.ZodType<T>, name: string): StructuredCall<T>;
}

export interface ChatModelOptions {
  /** Deterministic by default. Every Orbit call site is extraction, not composition. */
  readonly temperature?: number;
  readonly maxRetries?: number;
}

export class ModelSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelSelectionError';
  }
}

function requireApiKey(selection: ModelSelection): string {
  if (selection.apiKey === undefined || selection.apiKey.trim() === '') {
    throw new ModelSelectionError(
      `A ${selection.family} model was requested for direct invocation with no API key. ` +
        'Resolve the selection through resolveModelSelection, which reports this as ' +
        'unconfigured rather than constructing a client that cannot work.',
    );
  }

  return selection.apiKey;
}

function baseChatModel(selection: ModelSelection, options: ChatModelOptions): BaseChatModel {
  const temperature = options.temperature ?? 0;
  const maxRetries = options.maxRetries ?? 2;

  if (selection.invocation === 'bedrock') {
    if (selection.region === undefined || selection.region.trim() === '') {
      throw new ModelSelectionError(
        'Bedrock invocation was requested with no AWS region. Bedrock is region-scoped.',
      );
    }

    // No `credentials` argument on purpose. Omitting it is what hands
    // resolution to the AWS SDK's default credential provider chain, which is
    // the mechanism everything else in an AWS account already uses. Orbit holds
    // no AWS secret of its own and offers no variable for one.
    return new ChatBedrockConverse({
      model: selection.model,
      region: selection.region,
      temperature,
      maxRetries,
    });
  }

  if (selection.family === 'gemini') {
    return new ChatGoogleGenerativeAI({
      apiKey: requireApiKey(selection),
      model: selection.model,
      temperature,
      maxRetries,
    });
  }

  return new ChatAnthropic({
    apiKey: requireApiKey(selection),
    model: selection.model,
    temperature,
    maxRetries,
  });
}

export function createChatModel(
  selection: ModelSelection,
  options: ChatModelOptions = {},
): OrbitChatModel {
  const chat = baseChatModel(selection, options);

  return {
    selection,
    descriptor: { provider: providerLabel(selection), model: selection.model },

    bindSchema<T>(schema: z.ZodType<T>, name: string): StructuredCall<T> {
      // `includeRaw` is set for every call in Orbit, whichever provider is
      // active. It is what makes a schema violation arrive as data — the
      // drafting repair loop needs the model's unvalidated arguments, and every
      // other caller needs to distinguish "did not satisfy the schema" from
      // "the provider was unreachable". Without it LangChain throws for both.
      // Typed loosely at the LangChain seam and narrowed back immediately.
      // `withStructuredOutput` constrains its parameter to `Record<string, any>`,
      // which would push that constraint onto every caller's domain type for no
      // benefit — the schema is the thing that decides the shape, and it is
      // already `z.ZodType<T>` on the way in.
      const structured = chat.withStructuredOutput(schema as z.ZodType<Record<string, unknown>>, {
        name,
        includeRaw: true,
      });

      return {
        async invoke(
          messages: readonly ChatMessage[],
          callOptions: StructuredCallOptions = {},
        ): Promise<StructuredResult<T>> {
          const response = await structured.invoke(
            messages.map((message) => ({ role: message.role, content: message.content })),
            callOptions.timeoutMs === undefined ? undefined : { timeout: callOptions.timeoutMs },
          );

          // The overload promises `parsed: T`; at run time LangChain leaves it
          // undefined when the reply did not satisfy the schema. Widening is
          // the honest type, and every caller already branches on it.
          return { raw: response.raw, parsed: response.parsed as T | undefined };
        },
      };
    },
  };
}
