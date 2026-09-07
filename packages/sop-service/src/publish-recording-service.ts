import type { CompileRefusal, OutcomeMapping } from '@orbit/agent-ir-compiler';
import type { SopDocumentId } from '@orbit/contracts';
import { createRepositories, type AgentVersionRecord, type OrbitDatabase } from '@orbit/db';

import { createPublishPipeline } from './publish-pipeline';

/**
 * Publishing a recorded workflow in one action, rather than five.
 *
 * The full pipeline — approve the revision, compile it, approve the
 * candidate, publish — exists to separate two questions that matter for a
 * workflow nobody demonstrated: is this the business process we want (a
 * person's judgement), and is what got compiled actually safe to run (a
 * separate technical check). A recording answers the first question by
 * construction: a person did every action in it with their own hands, in a
 * real browser, which is the same reasoning ADR-019 already uses to
 * auto-approve a binding the moment it is demonstrated rather than asking for
 * a second click.
 *
 * This does not remove any of the underlying states or skip the technical
 * check — every row this produces is identical to what clicking through each
 * screen by hand would have produced, and `assessSandboxReadiness`'s
 * fail-closed secret gate still runs inside `compileDocument` exactly as it
 * always has. What is removed is asking a person to confirm, one screen at a
 * time, a sequence of actions they just finished performing. It is scoped to
 * `provenance.kind === 'recorded'` specifically: a workflow nobody
 * demonstrated has to have been confirmed against a real page some other way
 * before it gets a one-click path — which is what
 * `publish-bound-document-service.ts` covers, step by step instead of all at
 * once (ADR-027).
 *
 * The one thing this does not skip: what a reached outcome *means* in business
 * terms. Nothing about a recording answers whether finishing at a given point
 * means the request was found or was not, so the caller still supplies that.
 */

export type PublishRecordingResult =
  | { readonly ok: true; readonly agentVersion: AgentVersionRecord }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'not_recorded' }
  | {
      readonly ok: false;
      readonly reason: 'revision_not_publishable';
      readonly state: string;
    }
  | {
      readonly ok: false;
      readonly reason: 'questions_unanswered';
      readonly unansweredQuestionIds: readonly string[];
    }
  | { readonly ok: false; readonly reason: 'refused'; readonly refusals: readonly CompileRefusal[] }
  | { readonly ok: false; readonly reason: 'not_ready'; readonly sandboxState: string }
  | { readonly ok: false; readonly reason: 'already_published'; readonly agentVersionId: string };

export interface PublishRecordingService {
  publish(
    documentId: SopDocumentId,
    outcomeMapping: OutcomeMapping,
  ): Promise<PublishRecordingResult>;
}

export function createPublishRecordingService(options: {
  readonly database: OrbitDatabase;
}): PublishRecordingService {
  const pipeline = createPublishPipeline(options);
  const repositories = createRepositories(options.database);

  return {
    async publish(documentId, outcomeMapping) {
      const document = await repositories.sopDocuments.findById(documentId);
      if (document === null) {
        return { ok: false, reason: 'not_found' };
      }

      const revision = await repositories.sopGraphRevisions.findCurrent(documentId);
      if (revision === null) {
        return { ok: false, reason: 'not_found' };
      }

      // The guard that keeps this path from ever standing in for real review:
      // only a demonstrated workflow gets *this* fast path. A workflow that was
      // drafted rather than recorded is not refused automation forever — it is
      // refused it here, until every one of its steps has been confirmed
      // against a real page one at a time.
      if (revision.provenance.kind !== 'recorded') {
        return { ok: false, reason: 'not_recorded' };
      }

      return pipeline.run({ documentId, revision, outcomeMapping });
    },
  };
}
