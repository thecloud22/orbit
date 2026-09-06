import type { SopDocumentId } from '@orbit/contracts';
import {
  withTransaction,
  type OrbitDatabase,
  type SopDocumentRecord,
  type SopGraphRevisionRecord,
  type SopRevisionProvenance,
} from '@orbit/db';
import { generateSopGraph, type GenerationMetadata, type LLMProvider } from '@orbit/sop-generation';
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
  | { readonly ok: false; readonly reason: 'provider_error'; readonly message: string };

export interface SopDraftService {
  createDraft(input: CreateSopDraftInput): Promise<CreateSopDraftResult>;
}

export interface SopDraftServiceOptions {
  readonly database: OrbitDatabase;
  readonly provider: LLMProvider;
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

      // Generation happens before any transaction is opened. A model call takes
      // seconds and may retry; holding a database transaction across it would
      // pin a connection and keep locks for the whole of it.
      const generated = await generateSopGraph({ provider, sourceText });

      if (!generated.ok) {
        return generated.reason === 'provider_error'
          ? { ok: false, reason: 'provider_error', message: generated.message }
          : { ok: false, reason: 'invalid_after_repair', issues: generated.issues };
      }

      const { graph, generation } = generated;

      // Document and first revision land together or not at all. `create` opens
      // its own transaction internally, which becomes a savepoint inside this
      // one rather than a second connection-level transaction — the property the
      // atomicity of this whole method rests on, and one the tests assert
      // rather than assume.
      return withTransaction(database, async (repositories) => {
        const document =
          existingDocument ??
          (await repositories.sopDocuments.create({ title: graph.title, sourceText }));

        const parent = await repositories.sopGraphRevisions.findCurrent(document.id);

        const revision = await repositories.sopGraphRevisions.create({
          documentId: document.id,
          graph,
          provenance: provenanceOf(generation),
          ...(parent === null ? {} : { parentRevisionId: parent.id }),
        });

        return { ok: true, document, revision, generation };
      });
    },
  };
}
