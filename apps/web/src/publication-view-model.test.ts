import type { SopPublicationView } from '@orbit/api/views';
import { describe, expect, it } from 'vitest';

import { ApiRequestError } from './api-client';
import {
  canPublish,
  describePublishFailure,
  publicationStage,
  publicationSummary,
} from './publication-view-model';

function publication(overrides: Partial<SopPublicationView> = {}): SopPublicationView {
  return {
    candidateId: null,
    candidateState: null,
    sandboxState: null,
    agentVersionId: null,
    agentVersion: null,
    ...overrides,
  };
}

describe('publicationStage', () => {
  it('starts at not compiled, which is where every document begins', () => {
    expect(publicationStage(publication())).toEqual({ kind: 'not_compiled' });
    expect(canPublish(publicationStage(publication()))).toBe(false);
  });

  it('will not offer publishing for a candidate nobody approved', () => {
    const stage = publicationStage(
      publication({ candidateId: 'aircand_1', candidateState: 'compiled', sandboxState: 'ready' }),
    );

    expect(stage.kind).toBe('awaiting_approval');
    expect(canPublish(stage)).toBe(false);
  });

  it('will not offer publishing for a workflow that could never be checked', () => {
    // A workflow needing a secret Orbit cannot supply is a dead end, and saying
    // so is more useful than a button that always fails.
    const stage = publicationStage(
      publication({
        candidateId: 'aircand_1',
        candidateState: 'compiled',
        sandboxState: 'cannot_validate',
      }),
    );

    expect(stage.kind).toBe('cannot_validate');
    expect(canPublish(stage)).toBe(false);
    expect(publicationSummary(stage)).toContain('sign-in');
  });

  it('offers publishing exactly once a candidate is approved', () => {
    const stage = publicationStage(
      publication({ candidateId: 'aircand_1', candidateState: 'approved', sandboxState: 'ready' }),
    );

    expect(stage).toEqual({ kind: 'publishable', candidateId: 'aircand_1' });
    expect(canPublish(stage)).toBe(true);
  });

  it('reports a published workflow by its agent, not by a changed document', () => {
    const stage = publicationStage(
      publication({
        candidateId: 'aircand_1',
        candidateState: 'approved',
        agentVersionId: 'agentv_1',
        agentVersion: '0.1.0',
      }),
    );

    expect(stage).toEqual({ kind: 'published', agentVersionId: 'agentv_1', version: '0.1.0' });

    // The summary points somewhere else on purpose: the document did not become
    // runnable, a separate artifact did (ADR-016).
    expect(publicationSummary(stage)).toContain('not here');
    expect(canPublish(stage)).toBe(false);
  });
});

describe('describePublishFailure', () => {
  it('treats an already-published workflow as done, not as an error', () => {
    const failure = describePublishFailure(
      new ApiRequestError({ status: 409, message: 'Already published.' }),
    );

    expect(failure.kind).toBe('already_published');
  });

  it('reports an unapproved candidate in the server’s own words', () => {
    const failure = describePublishFailure(
      new ApiRequestError({ status: 400, message: 'This workflow is compiled.' }),
    );

    expect(failure.kind).toBe('not_approved');
    expect(failure.message).toContain('compiled');
  });

  it('treats anything else as a request problem', () => {
    const failure = describePublishFailure(
      new ApiRequestError({ status: 500, message: 'Something broke.' }),
    );

    expect(failure.kind).toBe('request_failed');
  });
});
