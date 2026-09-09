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

      // Asked of the candidate chain and the version rows, which is where the
      // answer already lives -- the same path `publicationStatusFor` walks for
      // the review page. A second way of deciding "is something running from
      // this?" would be a second thing to keep true.
      const candidate = await repositories.agentIrCandidates.findCurrent(documentId);

      if (candidate !== null) {
        const live = (
          await repositories.agentVersions.listByAgent(candidate.agentIr.id as never)
        ).find((version) => version.publishedFromCandidateId === candidate.id);

        if (live !== undefined) {
          return { ok: false, reason: 'published', agentVersion: live.version };
        }
      }

      await repositories.sopDocuments.discard(documentId);

      return { ok: true };
    },
  };
}
