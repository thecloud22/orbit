import { newModelRequestId, type ModelRequestId, type SopDocumentId } from '@orbit/contracts';
import {
  createRepositories,
  withTransaction,
  type OrbitDatabase,
  type SopDocumentRecord,
  type SopGraphRevisionRecord,
  type SopRevisionProvenance,
} from '@orbit/db';
import {
  estimateCostMicroUsd,
  generateSopGraph,
  type BudgetRefusal,
  type GenerationMetadata,
  type LLMProvider,
  type ModelBudgets,
  type ModelRates,
  type ModelSpend,
  type RecordedModelCall,
} from '@orbit/sop-generation';
import type { SopGraphIssue } from '@orbit/sop-graph';

/**
 * Generation composed with persistence.
 *
 * This is the only place @orbit/sop-generation and @orbit/db meet, following
 * the shape @orbit/artifact-service already established: neither of the two
 * packages may import the other, and the composition that needs both lives in a
 * third that they do not know about.
 */

/**
 * Two ways to make a draft, and they are kept apart deliberately.
 *
 * A document owns its source text, and that text has no update path (ADR-016):
 * "what did the user originally write?" stops being answerable the moment it
 * can be edited in place. So a new revision regenerates from the text the
 * document already holds. Supplying fresh text for an existing document would
 * be an edit in disguise, and this type makes it unrepresentable rather than
 * rejecting it later.
 */
export type CreateSopDraftInput =
  | { readonly kind: 'new_document'; readonly sourceText: string }
  | { readonly kind: 'new_revision'; readonly documentId: SopDocumentId };

export type CreateSopDraftResult =
  | {
      readonly ok: true;
      readonly document: SopDocumentRecord;
      readonly revision: SopGraphRevisionRecord;
      readonly generation: GenerationMetadata;
    }
  | {
      readonly ok: false;
      readonly reason: 'document_not_found';
      readonly documentId: SopDocumentId;
    }
  | {
      readonly ok: false;
      readonly reason: 'invalid_after_repair';
      readonly issues: readonly SopGraphIssue[];
    }
  /** No call was made: a budget was already exhausted (ADR-029). */
  | { readonly ok: false; readonly reason: 'budget_exhausted'; readonly refusal: BudgetRefusal }
  /**
   * The draft is invalid and the repair that might have fixed it was refused.
   *
   * Both facts are returned because both are true, and reporting either alone
   * would mislead: the issues without the reason look like a model that failed,
   * and the reason without the issues hides what the draft actually got wrong.
   */
  | {
      readonly ok: false;
      readonly reason: 'budget_exhausted_before_repair';
      readonly issues: readonly SopGraphIssue[];
      readonly refusal: BudgetRefusal;
    }
  | { readonly ok: false; readonly reason: 'provider_error'; readonly message: string };

export interface SopDraftService {
  createDraft(input: CreateSopDraftInput): Promise<CreateSopDraftResult>;
}

export interface SopDraftServiceOptions {
  readonly database: OrbitDatabase;
  readonly provider: LLMProvider;
  /**
   * Token ceilings per scope. Omitted entirely means uncapped, which is what a
   * deployment that has set nothing gets.
   */
  readonly budgets?: ModelBudgets;
  /** Per-model rates for the cost estimate. An estimate, never a bill. */
  readonly rates?: ModelRates;
}

function provenanceOf(generation: GenerationMetadata): SopRevisionProvenance {
  return {
    kind: 'generated',
    model: generation.model,
    provider: generation.provider,
    promptVersion: generation.promptVersion,
    generatedAt: generation.generatedAt,
  };
}

export function createSopDraftService(options: SopDraftServiceOptions): SopDraftService {
  const { database, provider } = options;
  const budgets = options.budgets ?? {};
  const rates = options.rates ?? {};
  const repositories = createRepositories(database);

  /**
   * What each scope has already spent, summed from the ledger.
   *
   * Summed rather than counted from a running total kept elsewhere: the number
   * the budget is enforced against and the number a person is shown then come
   * from the same rows and cannot disagree.
   *
   * `request` is always zero here, because the request id is minted for this
   * call and nothing has been charged to it yet. It is the pipeline that adds
   * this run's own calls to every scope as it goes.
   */
  async function spendFor(documentId: SopDocumentId | null): Promise<ModelSpend> {
    const global = await repositories.modelUsage.totals();
    const document =
      documentId === null
        ? { totalTokens: 0 }
        : await repositories.modelUsage.totalsForDocument(documentId);

    return { global: global.totalTokens, document: document.totalTokens, request: 0 };
  }

  /** Writes one ledger row per call the pipeline actually made. */
  async function recordCalls(input: {
    readonly requestId: ModelRequestId;
    readonly documentId: SopDocumentId | null;
    readonly calls: readonly RecordedModelCall[];
  }): Promise<void> {
    for (const call of input.calls) {
      await repositories.modelUsage.record({
        requestId: input.requestId,
        ...(input.documentId === null ? {} : { documentId: input.documentId }),
        provider: provider.descriptor.provider,
        model: provider.descriptor.model,
        inputTokens: call.usage.inputTokens,
        outputTokens: call.usage.outputTokens,
        estimatedCostMicroUsd: estimateCostMicroUsd({
          usage: call.usage,
          model: provider.descriptor.model,
          rates,
        }),
        attempt: call.attempt,
      });
    }
  }

  return {
    async createDraft(input) {
      let sourceText: string;
      let existingDocument: SopDocumentRecord | null = null;

      if (input.kind === 'new_revision') {
        existingDocument = await withTransaction(database, (repositories) =>
          repositories.sopDocuments.findById(input.documentId),
        );

        if (existingDocument === null) {
          return { ok: false, reason: 'document_not_found', documentId: input.documentId };
        }

        sourceText = existingDocument.sourceText;
      } else {
        sourceText = input.sourceText;
      }

      const requestId = newModelRequestId();
      const documentId = existingDocument?.id ?? null;

      // Generation happens before any transaction is opened. A model call takes
      // seconds and may retry; holding a database transaction across it would
      // pin a connection and keep locks for the whole of it.
      const generated = await generateSopGraph({
        provider,
        sourceText,
        budgets,
        spend: await spendFor(documentId),
      });

      // Written before anything else is decided, and outside the transaction
      // below. A call that was made has to be recorded whatever became of what
      // it produced — including when the draft is about to be thrown away —
      // because the tokens are spent either way.
      await recordCalls({ requestId, documentId, calls: generated.calls });

      if (!generated.ok) {
        switch (generated.reason) {
          case 'provider_error':
            return { ok: false, reason: 'provider_error', message: generated.message };
          case 'budget_exhausted':
            return { ok: false, reason: 'budget_exhausted', refusal: generated.refusal };
          case 'budget_exhausted_before_repair':
            return {
              ok: false,
              reason: 'budget_exhausted_before_repair',
              issues: generated.issues,
              refusal: generated.refusal,
            };
          case 'invalid_after_repair':
            return { ok: false, reason: 'invalid_after_repair', issues: generated.issues };
        }
      }

      const { graph, generation } = generated;

      // Document and first revision land together or not at all. `create` opens
      // its own transaction internally, which becomes a savepoint inside this
      // one rather than a second connection-level transaction — the property the
      // atomicity of this whole method rests on, and one the tests assert
      // rather than assume.
      return withTransaction(database, async (transactional) => {
        const document =
          existingDocument ??
          (await transactional.sopDocuments.create({ title: graph.title, sourceText }));

        const parent = await transactional.sopGraphRevisions.findCurrent(document.id);

        const revision = await transactional.sopGraphRevisions.create({
          documentId: document.id,
          graph,
          provenance: provenanceOf(generation),
          ...(parent === null ? {} : { parentRevisionId: parent.id }),
        });

        // A new document did not exist when its own first call was made, so
        // those rows were written unattributed. Adopting them here is what
        // makes the per-document scope answerable for every later revision —
        // and it only ever fills in a null, so it cannot move spend between
        // documents.
        if (documentId === null) {
          await transactional.modelUsage.attachDocument(requestId, document.id);
        }

        return { ok: true, document, revision, generation };
      });
    },
  };
}
