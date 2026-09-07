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
  | { readonly kind: 'cannot_validate'; readonly candidateId: string }
  /** Approved. This is the only stage that offers a Publish action. */
  | { readonly kind: 'publishable'; readonly candidateId: string }
  /** Published. The page links out rather than changing its own claim. */
  | { readonly kind: 'published'; readonly agentVersionId: string; readonly version: string };

export function publicationStage(publication: SopPublicationView): PublicationStage {
  if (publication.agentVersionId !== null) {
    return {
      kind: 'published',
      agentVersionId: publication.agentVersionId,
      version: publication.agentVersion ?? '',
    };
  }

  if (publication.candidateId === null) {
    return { kind: 'not_compiled' };
  }

  if (publication.sandboxState === 'cannot_validate') {
    return { kind: 'cannot_validate', candidateId: publication.candidateId };
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
      return 'This workflow needs a sign-in Orbit cannot perform yet, so it cannot be approved or published.';
    case 'publishable':
      return 'This workflow has been approved and can be published as a runnable agent.';
    case 'published':
      return `Published as version ${stage.version}. Running it happens on the agent, not here.`;
  }
}

export function canPublish(stage: PublicationStage): boolean {
  return stage.kind === 'publishable';
}

export function canApprove(
  stage: PublicationStage,
): stage is { kind: 'awaiting_approval'; candidateId: string } {
  return stage.kind === 'awaiting_approval';
}

/**
 * Whether compiling can be offered at all, independent of `PublicationStage`.
 *
 * `not_compiled` alone is not enough: compiling reads the workflow's own
 * *revision* state, not its publication state, and a revision only compiles
 * once a reviewer has approved it (ADR-017) — a rule enforced on the server,
 * mirrored here only so the button does not invite a request that will only
 * ever be refused.
 */
export function canCompile(input: {
  readonly stage: PublicationStage;
  readonly revisionState: string;
  readonly declaredOutcomeCount: number;
}): boolean {
  return (
    input.stage.kind === 'not_compiled' &&
    input.revisionState === 'approved' &&
    input.declaredOutcomeCount > 0
  );
}

/** Why compiling is not offered yet, when it isn't — for the reviewer, not a log. */
export function compileBlockedReason(input: {
  readonly stage: PublicationStage;
  readonly revisionState: string;
  readonly declaredOutcomeCount: number;
}): string | null {
  if (input.stage.kind !== 'not_compiled') {
    return null;
  }

  if (input.revisionState !== 'approved') {
    return 'Approve this workflow in review before it can be turned into an agent.';
  }

  if (input.declaredOutcomeCount === 0) {
    return 'This workflow has no outcome step yet, so it has nothing to compile into.';
  }

  return null;
}

export type PublishFailureKind = 'not_approved' | 'already_published' | 'request_failed';

export interface PublishFailure {
  readonly kind: PublishFailureKind;
  readonly message: string;
  /** Set when the agent already existed, so the page can still link to it. */
  readonly agentVersionId: string | null;
}

export function describePublishFailure(error: ApiRequestError): PublishFailure {
  if (error.status === 409) {
    // Already published is not a failure of intent — the thing the person
    // wanted exists. The page links to it rather than showing an error.
    return {
      kind: 'already_published',
      message: 'This workflow has already been published.',
      agentVersionId: null,
    };
  }

  return {
    kind: error.status === 400 ? 'not_approved' : 'request_failed',
    message: error.message,
    agentVersionId: null,
  };
}

export interface CompileFailure {
  readonly message: string;
  /** One line per refusal, when the server named them (ADR-021). Empty otherwise. */
  readonly refusals: readonly string[];
}

export function describeCompileFailure(error: ApiRequestError): CompileFailure {
  return {
    message: error.message,
    refusals: error.details.map((detail) => detail.message),
  };
}

export interface ApproveFailure {
  readonly message: string;
}

export function describeApproveFailure(error: ApiRequestError): ApproveFailure {
  return { message: error.message };
}
