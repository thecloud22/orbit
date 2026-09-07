import type { CompileRefusal } from '@orbit/agent-ir-compiler';
import type { SopDocumentId } from '@orbit/contracts';
import type { AgentVersionRecord, OrbitDatabase, SopGraphRevisionRecord } from '@orbit/db';

import { createSopCandidateService } from './candidate-service';
import { createSopPublishService } from './publish-service';
import { createSopRevisionService } from './revision-service';

/**
 * Approve the revision if it still needs it, compile, approve the candidate,
 * publish.
 *
 * Extracted because there are now two one-click publish paths — a recorded
 * workflow (ADR-025) and a fully bound drafted one (ADR-027) — and they differ
 * only in the precondition each checks before running this. Two copies of the
 * sequence would be two places for a state transition to drift, in exactly the
 * part of the system where "what states did this actually go through" is the
 * product.
 *
 * Nothing here is a shortcut past a check. Every row this produces is identical
 * to what clicking through each screen by hand would have produced, and
 * `assessSandboxReadiness`'s fail-closed secret gate still runs inside
 * `compileDocument`. What the callers remove is asking a person to confirm, one
 * screen at a time, something already confirmed some other way.
 */

export type PublishPipelineResult =
  | { readonly ok: true; readonly agentVersion: AgentVersionRecord }
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

export interface PublishPipeline {
  run(input: {
    readonly documentId: SopDocumentId;
    readonly revision: SopGraphRevisionRecord;
  }): Promise<PublishPipelineResult>;
}

export function createPublishPipeline(options: {
  readonly database: OrbitDatabase;
}): PublishPipeline {
  const revisions = createSopRevisionService(options);
  const candidates = createSopCandidateService(options);
  const publisher = createSopPublishService(options);

  return {
    async run({ documentId, revision }) {
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

      const compiled = await candidates.compileDocument({ documentId });

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
