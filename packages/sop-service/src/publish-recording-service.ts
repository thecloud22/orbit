import type { CompileRefusal, OutcomeMapping } from '@orbit/agent-ir-compiler';
import type { SopDocumentId } from '@orbit/contracts';
import { createRepositories, type AgentVersionRecord, type OrbitDatabase } from '@orbit/db';

import { createSopCandidateService } from './candidate-service';
import { createSopPublishService } from './publish-service';
import { createSopRevisionService } from './revision-service';

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
 * `provenance.kind === 'recorded'` specifically: an AI-drafted workflow has no
 * demonstrated interaction behind it, so the business-judgement question is
 * still open and still needs an actual human review.
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
  const revisions = createSopRevisionService(options);
  const candidates = createSopCandidateService(options);
  const publisher = createSopPublishService(options);
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
      // only a demonstrated workflow gets the fast path. An AI-authored draft
      // has no interaction behind it, so its business intent is still
      // unreviewed and this refuses rather than treating a draft as approved.
      if (revision.provenance.kind !== 'recorded') {
        return { ok: false, reason: 'not_recorded' };
      }

      // Drive only the transition actually needed, so this works whether a
      // person already clicked through part of the review page by hand or
      // never touched it at all.
      if (revision.state === 'draft' || revision.state === 'needs_clarification') {
        const submitted = await revisions.transition({
          revisionId: revision.id,
          action: 'submit_for_review',
        });

        if (!submitted.ok) {
          return submitted.reason === 'questions_unanswered'
            ? {
                ok: false,
                reason: 'questions_unanswered',
                unansweredQuestionIds: submitted.unansweredQuestionIds,
              }
            : { ok: false, reason: 'revision_not_publishable', state: revision.state };
        }

        const approved = await revisions.transition({ revisionId: revision.id, action: 'approve' });
        if (!approved.ok) {
          return { ok: false, reason: 'revision_not_publishable', state: 'in_review' };
        }
      } else if (revision.state === 'in_review') {
        const approved = await revisions.transition({ revisionId: revision.id, action: 'approve' });
        if (!approved.ok) {
          return { ok: false, reason: 'revision_not_publishable', state: 'in_review' };
        }
      } else if (revision.state !== 'approved') {
        // rejected or superseded: nothing this action can do about either.
        return { ok: false, reason: 'revision_not_publishable', state: revision.state };
      }

      const compiled = await candidates.compileDocument({ documentId, outcomeMapping });

      if (!compiled.ok) {
        if (compiled.reason === 'refused') {
          return { ok: false, reason: 'refused', refusals: compiled.refusals };
        }
        // `not_found` and `no_approved_revision` are unreachable here — the
        // document and an approved revision were just confirmed above — and
        // `revision_not_approved` cannot recur immediately after the approval
        // this function just drove. Reported plainly rather than assumed away.
        return { ok: false, reason: 'revision_not_publishable', state: compiled.reason };
      }

      const approvedCandidate = await candidates.approve(compiled.candidate.id);

      if (!approvedCandidate.ok) {
        return approvedCandidate.reason === 'not_ready'
          ? { ok: false, reason: 'not_ready', sandboxState: approvedCandidate.sandboxState }
          : { ok: false, reason: 'revision_not_publishable', state: approvedCandidate.reason };
      }

      const published = await publisher.publish(approvedCandidate.candidate.id);

      if (!published.ok) {
        return published.reason === 'already_published'
          ? { ok: false, reason: 'already_published', agentVersionId: published.agentVersionId }
          : { ok: false, reason: 'revision_not_publishable', state: published.reason };
      }

      return { ok: true, agentVersion: published.agentVersion };
    },
  };
}
