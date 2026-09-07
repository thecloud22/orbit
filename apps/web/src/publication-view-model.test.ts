import type { SopPublicationView } from '@orbit/api/views';
import { describe, expect, it } from 'vitest';

import { ApiRequestError } from './api-client';
import {
  describePublishRecordingFailure,
  offersBoundPublish,
  offersOneClickPublish,
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
  });

  it('is awaiting approval once compiled but not yet approved', () => {
    const stage = publicationStage(
      publication({ candidateId: 'aircand_1', candidateState: 'compiled', sandboxState: 'ready' }),
    );

    expect(stage.kind).toBe('awaiting_approval');
  });

  it('cannot be validated when a workflow needs a secret Orbit cannot supply', () => {
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
    expect(publicationSummary(stage)).toContain('sign-in');
  });

  it('is publishable exactly once a candidate is approved', () => {
    const stage = publicationStage(
      publication({ candidateId: 'aircand_1', candidateState: 'approved', sandboxState: 'ready' }),
    );

    expect(stage).toEqual({ kind: 'publishable', candidateId: 'aircand_1' });
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
  });
});

describe('offersOneClickPublish', () => {
  it('offers the fast path for a recorded workflow that is not yet published', () => {
    expect(
      offersOneClickPublish({
        provenanceKind: 'recorded',
        stage: publicationStage(publication()),
      }),
    ).toBe(true);
  });

  it('has nothing left to offer once a recorded workflow is published', () => {
    const stage = publicationStage(
      publication({ agentVersionId: 'agentv_1', agentVersion: '0.1.0' }),
    );

    expect(offersOneClickPublish({ provenanceKind: 'recorded', stage })).toBe(false);
  });

  it('does not offer the fast path for a workflow that was not recorded', () => {
    // A drafted workflow has no demonstrated interaction behind it, so it still
    // needs the full manual review — the fast path exists only because a
    // person performed and confirmed a recording with their hands.
    expect(
      offersOneClickPublish({
        provenanceKind: 'drafted',
        stage: publicationStage(publication()),
      }),
    ).toBe(false);
  });
});

describe('describePublishRecordingFailure', () => {
  it('carries the server’s named refusals as plain lines', () => {
    const failure = describePublishRecordingFailure(
      new ApiRequestError({
        status: 400,
        message: 'This workflow could not be published.',
        details: [
          { field: 'search', message: '[missing_binding] not mapped yet' },
          { field: 'graph', message: '[unmapped_outcome] no mapping for "completed"' },
        ],
      }),
    );

    expect(failure.message).toContain('could not be published');
    expect(failure.refusals).toEqual([
      '[missing_binding] not mapped yet',
      '[unmapped_outcome] no mapping for "completed"',
    ]);
  });

  it('has no refusals to show when the server named none', () => {
    const failure = describePublishRecordingFailure(
      new ApiRequestError({ status: 400, message: 'This workflow is draft.' }),
    );

    expect(failure.refusals).toEqual([]);
  });
});

describe('offersBoundPublish', () => {
  it('offers the same one action to a drafted workflow once every step is bound', () => {
    expect(
      offersBoundPublish({
        provenanceKind: 'generated',
        stage: publicationStage(publication()),
        fullyBound: true,
      }),
    ).toBe(true);
  });

  it('offers nothing while a drafted workflow is still partly bound', () => {
    // The line ADR-025 drew is unchanged: nothing has confirmed these steps
    // against a real page yet, so there is no button to offer.
    expect(
      offersBoundPublish({
        provenanceKind: 'generated',
        stage: publicationStage(publication()),
        fullyBound: false,
      }),
    ).toBe(false);
  });

  it('leaves a recorded workflow to the recorded path', () => {
    expect(
      offersBoundPublish({
        provenanceKind: 'recorded',
        stage: publicationStage(publication()),
        fullyBound: true,
      }),
    ).toBe(false);
  });

  it('has nothing left to offer once the workflow is published', () => {
    const stage = publicationStage(
      publication({ agentVersionId: 'agentv_1', agentVersion: '0.1.0' }),
    );

    expect(offersBoundPublish({ provenanceKind: 'generated', stage, fullyBound: true })).toBe(
      false,
    );
  });
});
