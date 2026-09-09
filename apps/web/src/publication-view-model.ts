import type { SopPublicationView } from '@orbit/api/views';

import type { ApiRequestError } from './api-client';

/**
 * What the review page may say about publishing.
 *
 * The one rule this file exists to hold: publishing never changes what the
 * review page claims about the document. The SOP Graph is non-executable by
 * construction and stays that way (ADR-016), so the page keeps its "draft only"
 * notice and gains a link to a separate artifact. There is deliberately no
 * function here that turns `executable` into anything.
 */

export type PublicationStage =
  /** Nothing compiled yet. */
  | { readonly kind: 'not_compiled' }
  /** Compiled, but not approved, so it cannot be published. */
  | { readonly kind: 'awaiting_approval'; readonly candidateId: string }
  /** Compiled and checked but never approvable — needs a secret Orbit cannot supply. */
  | {
      readonly kind: 'cannot_validate';
      readonly candidateId: string;
      /**
       * The specific reason, naming which input -- e.g. `password` -- rather
       * than the generic sandbox-state fact. `null` on the rare candidate
       * that reached this state with nothing recorded about why.
       */
      readonly note: string | null;
    }
  /**
   * Rejected by a reviewer's own decision, most often from `cannot_validate`.
   * Recompiling still supersedes it and starts a fresh candidate, which is
   * why this is not `not_compiled` again: the panel says what happened, not
   * just that nothing exists yet.
   */
  | { readonly kind: 'rejected'; readonly candidateId: string }
  /** Approved. This is the only stage that offers a Publish action. */
  | { readonly kind: 'publishable'; readonly candidateId: string }
  /** Published. The page links out rather than changing its own claim. */
  | {
      readonly kind: 'published';
      readonly agentVersionId: string;
      readonly version: string;
      /**
       * The document has moved on since that version was compiled.
       *
       * True from the moment somebody revises a published workflow (ADR-036):
       * a version is still running, and the revision on screen is not the one
       * it was built from. It is what re-opens the publish action, which would
       * otherwise disappear for good the first time a workflow was published.
       */
      readonly hasNewerRevision: boolean;
    };

/**
 * @param currentRevisionId The revision being reviewed. Omit when the caller is
 * only naming the stage and has no revision in hand; `hasNewerRevision` is then
 * false, which is the conservative reading — it withholds a publish action
 * rather than offering one on an unknown.
 */
export function publicationStage(
  publication: SopPublicationView,
  currentRevisionId?: string,
): PublicationStage {
  if (publication.agentVersionId !== null) {
    return {
      kind: 'published',
      agentVersionId: publication.agentVersionId,
      version: publication.agentVersion ?? '',
      hasNewerRevision:
        currentRevisionId !== undefined &&
        publication.compiledFromRevisionId !== null &&
        publication.compiledFromRevisionId !== currentRevisionId,
    };
  }

  if (publication.candidateId === null) {
    return { kind: 'not_compiled' };
  }

  if (publication.candidateState === 'rejected') {
    return { kind: 'rejected', candidateId: publication.candidateId };
  }

  if (publication.sandboxState === 'cannot_validate') {
    return {
      kind: 'cannot_validate',
      candidateId: publication.candidateId,
      note: publication.sandboxNote,
    };
  }

  return publication.candidateState === 'approved'
    ? { kind: 'publishable', candidateId: publication.candidateId }
    : { kind: 'awaiting_approval', candidateId: publication.candidateId };
}

/** What the panel says at each stage, in the reviewer's language. */
export function publicationSummary(stage: PublicationStage): string {
  switch (stage.kind) {
    case 'not_compiled':
      return 'This workflow has not been turned into an agent yet.';
    case 'awaiting_approval':
      return 'An agent has been compiled from this workflow and is waiting for technical approval.';
    case 'cannot_validate':
      // The specific reason `assessSandboxReadiness` computed at compile time
      // -- naming which input Orbit cannot supply -- when the candidate
      // recorded one. Falls back to the generic fact only for the rare
      // candidate that reached this state with nothing recorded about why.
      return (
        stage.note ??
        'This workflow needs a sign-in Orbit cannot perform yet, so it cannot be approved or published.'
      );
    case 'rejected':
      return 'This candidate was rejected. Publishing again compiles a fresh one.';
    case 'publishable':
      return 'This workflow has been approved and can be published as a runnable agent.';
    case 'published':
      return stage.hasNewerRevision
        ? `Version ${stage.version} is running. This revision has not been published — publishing it mints the next version under the same agent, and leaves ${stage.version} exactly as it is.`
        : `Published as version ${stage.version}. Running it happens on the agent, not here.`;
  }
}

export interface CompileFailure {
  readonly message: string;
  /** One line per refusal, when the server named them (ADR-021). Empty otherwise. */
  readonly refusals: readonly string[];
}

/**
 * Whether the one-click "just record and make it runnable" path applies.
 *
 * Scoped to a recorded workflow that has not been published yet — the same
 * boundary the server enforces (`publish-recording-service.ts`): a person
 * demonstrated every action in a recording personally, which stands in for
 * the business-judgement review a generated draft still needs for real. Once
 * published there is nothing left to do here but link to the agent — unless the
 * workflow has been revised since, which is a workflow on its way to a *next*
 * version rather than a finished one (ADR-036).
 */
export function offersOneClickPublish(input: {
  readonly provenanceKind: string;
  readonly stage: PublicationStage;
}): boolean {
  return input.provenanceKind === 'recorded' && isPublishableStage(input.stage);
}

/**
 * Whether a stage still has a publish in front of it.
 *
 * The one place "published" stops meaning "finished". Before ADR-036 a
 * published document had no way back to editable, so `kind !== 'published'` was
 * a complete answer; now a revised one is published *and* has an unpublished
 * revision, and withholding the button there would leave the fork with nothing
 * to do.
 *
 * Exported as well as used locally: `!isPublishableStage(stage)` is also
 * exactly the condition under which `SopPublishPanel` has nothing left to
 * show. The lead card one section up already carries that fact with a
 * working link this panel does not have (see its own module comment), so
 * that panel renders nothing at all rather than a dead-end restatement.
 */
export function isPublishableStage(stage: PublicationStage): boolean {
  return stage.kind !== 'published' || stage.hasNewerRevision;
}

/**
 * Whether a workflow nobody recorded may be published in one action.
 *
 * The condition is that every step the compiler needs a binding for has an
 * approved, up-to-date one — a technical precondition, not a review waiver.
 * This does not reopen the line ADR-025 drew: an unbound or partly bound draft
 * still gets no button, because nothing has confirmed its steps against a real
 * page. What changed is that a drafted workflow can now *reach* that state, one
 * demonstrated step at a time, which is the same confirmation a recording
 * provides assembled differently (ADR-027).
 */
export function offersBoundPublish(input: {
  readonly provenanceKind: string;
  readonly stage: PublicationStage;
  readonly fullyBound: boolean;
}): boolean {
  return input.provenanceKind !== 'recorded' && input.fullyBound && isPublishableStage(input.stage);
}

/** One line per refusal, when the server named them (ADR-021). Empty otherwise. */
export function describePublishRecordingFailure(error: ApiRequestError): CompileFailure {
  return {
    message: error.message,
    refusals: error.details.map((detail) => detail.message),
  };
}
