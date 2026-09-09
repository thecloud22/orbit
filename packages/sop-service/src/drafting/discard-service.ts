import type { SopDocumentId } from '@orbit/contracts';
import { createRepositories, type OrbitDatabase } from '@orbit/db';

/**
 * Discarding a workflow that is not going anywhere.
 *
 * Drafting is cheap and meant to be — a person describes something, sees what
 * Orbit made of it, and often decides it was the wrong shape. Before this there
 * was no way to say so, so every abandoned attempt stayed in the list forever
 * and the authoring surface slowly became a graveyard nobody could tidy.
 *
 * Two rules define it, and both are about what discarding must *not* be.
 *
 * **It is never a delete.** The row keeps its id and a `discardedAt` stamp,
 * exactly as an archived agent does (ADR-026). Revisions and bindings point at
 * this document, and "what was this workflow written from?" is a question
 * Phase 2 has to keep answering. A discarded document opens from a link that
 * somebody kept; it just leaves the list.
 *
 * **A published document cannot be discarded.** Its versions are running, and
 * a run's evidence traces back through the document it was compiled from.
 * Letting the source disappear from underneath a live agent would make the
 * authoring list tidier and the audit trail worse. The way to retire something
 * that is running is to archive the *agent*, which is a different act with
 * different consequences, and the refusal says so rather than doing it
 * silently on somebody's behalf.
 */

export type DiscardDocumentResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'already_discarded' }
  | {
      readonly ok: false;
      readonly reason: 'published';
      /** The version that is running, so the refusal can name it. */
      readonly agentVersion: string;
    };

export interface SopDiscardService {
  discard(documentId: SopDocumentId): Promise<DiscardDocumentResult>;
}

export function createSopDiscardService(options: {
  readonly database: OrbitDatabase;
}): SopDiscardService {
  const repositories = createRepositories(options.database);

  return {
    async discard(documentId) {
      const document = await repositories.sopDocuments.findById(documentId);

      if (document === null) {
        return { ok: false, reason: 'not_found' };
      }

      if (document.discardedAt !== null) {
        // Reported rather than treated as success, so a second click from a
        // stale page says what happened instead of implying it did something.
        return { ok: false, reason: 'already_discarded' };
      }

      // Asked across *every* candidate this document has produced, not just the
      // current one. Compilation supersedes the previous candidate before the
      // new one is approved, so a document whose latest publish attempt failed
      // has a current candidate carrying no version -- while an earlier version
      // is still running. Reading only the current candidate reported that
      // document as unpublished and let discarding remove the source of a live
      // agent, which is the one thing this check exists to prevent.
      const live = (await repositories.agentVersions.publishedByDocument(documentId)).get(
        documentId,
      );

      if (live !== undefined) {
        return { ok: false, reason: 'published', agentVersion: live };
      }

      await repositories.sopDocuments.discard(documentId);

      return { ok: true };
    },
  };
}
