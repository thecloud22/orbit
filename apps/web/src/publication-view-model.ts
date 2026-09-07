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
 * published there is nothing left to do here but link to the agent.
 */
export function offersOneClickPublish(input: {
  readonly provenanceKind: string;
  readonly stage: PublicationStage;
}): boolean {
  return input.provenanceKind === 'recorded' && input.stage.kind !== 'published';
}

/** One line per refusal, when the server named them (ADR-021). Empty otherwise. */
export function describePublishRecordingFailure(error: ApiRequestError): CompileFailure {
  return {
    message: error.message,
    refusals: error.details.map((detail) => detail.message),
  };
}
