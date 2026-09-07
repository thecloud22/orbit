import type { SopPublicationView } from '@orbit/api/views';
import { describe, expect, it } from 'vitest';

import { ApiRequestError } from './api-client';
import {
  canApprove,
  canCompile,
  canPublish,
  compileBlockedReason,
  describeApproveFailure,
  describeCompileFailure,
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

describe('canApprove', () => {
  it('offers approval only while a candidate is waiting for it', () => {
    const compiled = publicationStage(
      publication({ candidateId: 'aircand_1', candidateState: 'compiled', sandboxState: 'ready' }),
    );
    expect(canApprove(compiled)).toBe(true);

    const approved = publicationStage(
      publication({ candidateId: 'aircand_1', candidateState: 'approved', sandboxState: 'ready' }),
    );
    expect(canApprove(approved)).toBe(false);

    expect(canApprove(publicationStage(publication()))).toBe(false);
  });
});

describe('canCompile', () => {
  it('needs the revision approved, not just an absent candidate', () => {
    // Compiling reads the workflow's own revision state, which publication
    // status alone cannot see — this is the precondition the service enforces
    // and the button must not invite a request that will only be refused.
    expect(
      canCompile({
        stage: publicationStage(publication()),
        revisionState: 'draft',
        declaredOutcomeCount: 1,
      }),
    ).toBe(false);

    expect(
      canCompile({
        stage: publicationStage(publication()),
        revisionState: 'approved',
        declaredOutcomeCount: 1,
      }),
    ).toBe(true);
  });

  it('needs at least one declared outcome to map', () => {
    expect(
      canCompile({
        stage: publicationStage(publication()),
        revisionState: 'approved',
        declaredOutcomeCount: 0,
      }),
    ).toBe(false);
  });

  it('is never true once something has already been compiled', () => {
    const stage = publicationStage(
      publication({ candidateId: 'aircand_1', candidateState: 'compiled', sandboxState: 'ready' }),
    );

    expect(canCompile({ stage, revisionState: 'approved', declaredOutcomeCount: 1 })).toBe(false);
  });
});

describe('compileBlockedReason', () => {
  it('explains an unapproved revision in the reviewer’s own terms', () => {
    const reason = compileBlockedReason({
      stage: publicationStage(publication()),
      revisionState: 'in_review',
      declaredOutcomeCount: 1,
    });

    expect(reason).toContain('Approve');
  });

  it('explains a workflow with nothing to compile into', () => {
    const reason = compileBlockedReason({
      stage: publicationStage(publication()),
      revisionState: 'approved',
      declaredOutcomeCount: 0,
    });

    expect(reason).toContain('outcome step');
  });

  it('has nothing to say once compiling is possible or already done', () => {
    expect(
      compileBlockedReason({
        stage: publicationStage(publication()),
        revisionState: 'approved',
        declaredOutcomeCount: 1,
      }),
    ).toBeNull();

    const compiled = publicationStage(
      publication({ candidateId: 'aircand_1', candidateState: 'compiled', sandboxState: 'ready' }),
    );
    expect(
      compileBlockedReason({ stage: compiled, revisionState: 'approved', declaredOutcomeCount: 1 }),
    ).toBeNull();
  });
});

describe('describeCompileFailure', () => {
  it('carries the server’s named refusals as plain lines', () => {
    const failure = describeCompileFailure(
      new ApiRequestError({
        status: 400,
        message: 'This workflow could not be fully compiled.',
        details: [
          { field: 'search', message: '[missing_binding] not mapped yet' },
          { field: 'graph', message: '[unmapped_outcome] no mapping for "completed"' },
        ],
      }),
    );

    expect(failure.message).toContain('could not be fully compiled');
    expect(failure.refusals).toEqual([
      '[missing_binding] not mapped yet',
      '[unmapped_outcome] no mapping for "completed"',
    ]);
  });

  it('has no refusals to show when the server named none', () => {
    const failure = describeCompileFailure(
      new ApiRequestError({ status: 400, message: 'This workflow is draft.' }),
    );

    expect(failure.refusals).toEqual([]);
  });
});

describe('describeApproveFailure', () => {
  it('reports the server’s reason in its own words', () => {
    const failure = describeApproveFailure(
      new ApiRequestError({ status: 400, message: 'This workflow could not be checked.' }),
    );

    expect(failure.message).toContain('could not be checked');
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
