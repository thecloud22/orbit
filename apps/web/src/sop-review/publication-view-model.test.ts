import type { SopPublicationView } from '@orbit/api/views';
import { describe, expect, it } from 'vitest';

import { ApiRequestError } from '../api-client';
import {
  describePublishRecordingFailure,
  isPublishableStage,
  offersBoundPublish,
  offersOneClickPublish,
  publicationStage,
  publicationSummary,
} from './publication-view-model';

function publication(overrides: Partial<SopPublicationView> = {}): SopPublicationView {
  return {
    candidateId: null,
    candidateState: null,
    compiledFromRevisionId: null,
    sandboxState: null,
    sandboxNote: null,
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

  it('names the specific input when the candidate recorded why, instead of the generic story', () => {
    // The real gap this closes: assessSandboxReadiness computes exactly which
    // input blocks validation and why, and it used to be discarded between
    // the compiler and the panel -- every recorded sign-in read as the same
    // generic "needs a sign-in" sentence regardless of which secret it was.
    const stage = publicationStage(
      publication({
        candidateId: 'aircand_1',
        candidateState: 'compiled',
        sandboxState: 'cannot_validate',
        sandboxNote:
          'This workflow needs "password", which Orbit cannot supply yet. It was not tried ' +
          'against a real page, because doing so would mean opening a browser on a sign-in ' +
          'form with nothing to enter.',
      }),
    );

    expect(stage.kind).toBe('cannot_validate');
    expect(publicationSummary(stage)).toContain('"password"');
  });

  it('is rejected once a reviewer closes out a candidate, even one that could be checked', () => {
    // Rejection asks nothing of the sandbox -- checked here with
    // sandboxState: 'ready' precisely to prove candidateState wins the
    // reading, not sandboxState.
    const stage = publicationStage(
      publication({ candidateId: 'aircand_1', candidateState: 'rejected', sandboxState: 'ready' }),
    );

    expect(stage).toEqual({ kind: 'rejected', candidateId: 'aircand_1' });
    expect(publicationSummary(stage)).toContain('rejected');
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

    expect(stage).toEqual({
      kind: 'published',
      agentVersionId: 'agentv_1',
      version: '0.1.0',
      hasNewerRevision: false,
    });

    // The summary points somewhere else on purpose: the document did not become
    // runnable, a separate artifact did (ADR-016).
    expect(publicationSummary(stage)).toContain('not here');
  });

  it('reports a published workflow whose revision has moved on since (ADR-036)', () => {
    const stage = publicationStage(
      publication({
        candidateId: 'aircand_1',
        candidateState: 'approved',
        compiledFromRevisionId: 'sopr_1',
        agentVersionId: 'agentv_1',
        agentVersion: '0.1.0',
      }),
      'sopr_2',
    );

    expect(stage).toEqual({
      kind: 'published',
      agentVersionId: 'agentv_1',
      version: '0.1.0',
      hasNewerRevision: true,
    });

    // Both halves said out loud: the version is still running, and this is not
    // it. The second half is what revising produces and the first is what a
    // person is most afraid it undid.
    const summary = publicationSummary(stage);
    expect(summary).toContain('0.1.0 is running');
    expect(summary).toContain('has not been published');
  });

  it('reads a published workflow at the revision it was compiled from as unchanged', () => {
    const stage = publicationStage(
      publication({
        compiledFromRevisionId: 'sopr_1',
        agentVersionId: 'agentv_1',
        agentVersion: '0.1.0',
      }),
      'sopr_1',
    );

    expect(stage.kind === 'published' && stage.hasNewerRevision).toBe(false);
  });

  it('withholds the newer-revision claim when no revision was supplied', () => {
    // The conservative reading. A caller naming the stage without a revision in
    // hand must not have a publish action offered to it on an unknown.
    const stage = publicationStage(
      publication({
        compiledFromRevisionId: 'sopr_1',
        agentVersionId: 'agentv_1',
        agentVersion: '0.1.0',
      }),
    );

    expect(stage.kind === 'published' && stage.hasNewerRevision).toBe(false);
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

describe('isPublishableStage', () => {
  // The bug this pins: SopPublishPanel renders a whole "Publish" section
  // whenever this is true. A published document with nothing pending has
  // this false, and the panel renders nothing -- the lead card one section
  // up already says "Published as version X" with a working link, and a
  // second section repeating the same fact in prose with no link read as a
  // dead end rather than as the "nothing to do here" it actually was.
  it('is false once a document is published with nothing pending', () => {
    const stage = publicationStage(
      publication({ agentVersionId: 'agentv_1', agentVersion: '0.1.0' }),
    );

    expect(isPublishableStage(stage)).toBe(false);
  });

  it('is true again once a published document has been revised', () => {
    const stage = publicationStage(
      publication({
        agentVersionId: 'agentv_1',
        agentVersion: '0.1.0',
        compiledFromRevisionId: 'soprev_1',
      }),
      'soprev_2',
    );

    expect(isPublishableStage(stage)).toBe(true);
  });

  it('is true for every stage before publishing', () => {
    expect(isPublishableStage(publicationStage(publication()))).toBe(true);
    expect(
      isPublishableStage(
        publicationStage(publication({ candidateId: 'aircand_1', candidateState: 'approved' })),
      ),
    ).toBe(true);
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

  it('offers publishing again once a published workflow has been revised', () => {
    // The action the fork would otherwise have no way to finish: after ADR-036
    // a published document can be editable again, and withholding Publish there
    // would make revising a dead end.
    const stage = publicationStage(
      publication({
        compiledFromRevisionId: 'sopr_1',
        agentVersionId: 'agentv_1',
        agentVersion: '0.1.0',
      }),
      'sopr_2',
    );

    expect(offersBoundPublish({ provenanceKind: 'edited', stage, fullyBound: true })).toBe(true);
    expect(offersOneClickPublish({ provenanceKind: 'recorded', stage })).toBe(true);
  });

  it('still refuses a revised workflow whose steps are no longer all bound', () => {
    const stage = publicationStage(
      publication({
        compiledFromRevisionId: 'sopr_1',
        agentVersionId: 'agentv_1',
        agentVersion: '0.1.0',
      }),
      'sopr_2',
    );

    expect(offersBoundPublish({ provenanceKind: 'edited', stage, fullyBound: false })).toBe(false);
  });
});
