import type {
  RecoveryProposalView,
  SopBindingsView,
  SopReviewStepView,
  SopStepBindingView,
} from '@orbit/api/views';
import { describe, expect, it } from 'vitest';

import {
  bindActionLabel,
  bindingRows,
  canBindStep,
  needsHumanReview,
  describeBindingStatus,
  describeProposal,
  isBindingRequired,
  isFullyApproved,
  isFullyBoundForPublish,
  needsCallMapping,
  proposalForStep,
  summarizeBindings,
} from './sop-binding-view-model';

function entry(overrides: Partial<SopStepBindingView> = {}): SopStepBindingView {
  return {
    stepId: 'sign_in',
    kind: 'click',
    bindable: true,
    status: null,
    bindingId: null,
    supersededCount: 0,
    stale: false,
    issues: [],
    selectors: null,
    fingerprint: null,
    ...overrides,
  };
}

function reviewStep(overrides: Partial<SopReviewStepView> = {}): SopReviewStepView {
  return {
    id: 'sign_in',
    kind: 'click',
    summary: 'Sign in to the portal',
    position: 1,
    canMoveUp: false,
    canMoveDown: true,
    produces: [],
    group: null,
    step: {},
    ...overrides,
  };
}

function bindings(
  steps: readonly SopStepBindingView[],
  summary?: Partial<SopBindingsView['summary']>,
): SopBindingsView {
  return {
    documentId: 'sopdoc_1',
    revisionId: 'soprev_1',
    steps,
    summary: {
      bindable: steps.filter((step) => step.bindable).length,
      bound: steps.filter((step) => step.bindable && step.status !== null).length,
      approved: steps.filter((step) => step.status === 'approved').length,
      stale: steps.filter((step) => step.stale).length,
      ...summary,
    },
  };
}

describe('describeBindingStatus', () => {
  it('says an unbindable step needs no binding, rather than calling it missing', () => {
    const status = describeBindingStatus(entry({ bindable: false, kind: 'manual_review' }));

    expect(status.label).toBe('No binding needed');
    expect(status.tone).toBe('muted');
    expect(status.detail).toContain('routes to a person');
  });

  it('distinguishes not-yet-recorded from recorded', () => {
    expect(describeBindingStatus(entry()).label).toBe('Not recorded');
    expect(describeBindingStatus(entry({ status: 'draft' })).label).toBe(
      'Recorded, not yet submitted',
    );
  });

  it('reports staleness alongside the status, never instead of it', () => {
    // An approved binding whose step has changed is still approved, and still
    // not safe to run. Collapsing the two would hide whichever came second.
    const status = describeBindingStatus(entry({ status: 'approved', stale: true }));

    expect(status.label).toContain('Approved');
    expect(status.label).toContain('out of date');
    expect(status.tone).toBe('attention');
    expect(status.detail).toContain('recorded again');
  });

  it('gives approved its own tone', () => {
    expect(describeBindingStatus(entry({ status: 'approved' })).tone).toBe('success');
  });

  it('treats a rejected binding as needing attention', () => {
    expect(describeBindingStatus(entry({ status: 'rejected' })).tone).toBe('attention');
  });

  it('passes an unknown status through rather than dropping it', () => {
    expect(describeBindingStatus(entry({ status: 'something_new' })).label).toBe('something_new');
  });
});

describe('bindingRows', () => {
  const steps = [
    reviewStep(),
    reviewStep({ id: 'search', summary: 'Run the advanced search', position: 2 }),
  ];

  it('takes the step label from the review, not from a second renderer', () => {
    const rows = bindingRows(steps, bindings([entry(), entry({ stepId: 'search' })]));

    expect(rows.map((row) => row.label)).toEqual([
      'Sign in to the portal',
      'Run the advanced search',
    ]);
  });

  it('reads in the same order as the workflow above it', () => {
    const rows = bindingRows(steps, bindings([entry({ stepId: 'search' }), entry()]));
    expect(rows.map((row) => row.stepId)).toEqual(['sign_in', 'search']);
  });

  it('drops a binding for a step the current revision no longer has', () => {
    // Better absent than shown detached from anything.
    const rows = bindingRows(steps, bindings([entry({ stepId: 'deleted_step' })]));
    expect(rows).toEqual([]);
  });

  it('renders nothing at all when bindings could not be loaded', () => {
    expect(bindingRows(steps, null)).toEqual([]);
  });
});

describe('summarizeBindings', () => {
  it('counts approved against bindable, not against every step', () => {
    const summary = summarizeBindings(
      bindings([
        entry({ status: 'approved' }),
        entry({ stepId: 'b' }),
        entry({ stepId: 'c', bindable: false, kind: 'manual_review' }),
      ]),
    );

    // The unbindable step is excluded from the denominator; counting it would
    // make full coverage unreachable.
    expect(summary).toContain('1 of 2 steps ready');
  });

  it('counts only the kinds the compiler requires a binding for', () => {
    // The regression: `navigate` and `outcome` steps counted toward the
    // denominator, so a workflow whose every required step was bound reported
    // itself as incomplete while the publish button correctly offered to
    // publish it. The headline and the gate now answer from one predicate.
    const summary = summarizeBindings(
      bindings([
        entry({ status: 'approved' }),
        entry({ stepId: 'open', kind: 'navigate' }),
        entry({ stepId: 'done', kind: 'outcome' }),
      ]),
    );

    expect(summary).toContain('1 of 1 steps ready');
  });

  it('mentions recorded-but-unapproved separately', () => {
    expect(
      summarizeBindings(
        bindings([entry({ status: 'approved' }), entry({ stepId: 'b', status: 'draft' })]),
      ),
    ).toContain('1 recorded but not yet approved');
  });

  it('calls out stale bindings', () => {
    expect(summarizeBindings(bindings([entry({ status: 'approved', stale: true })]))).toContain(
      '1 out of date',
    );
  });

  it('says so when no step needs a binding', () => {
    expect(summarizeBindings(bindings([entry({ bindable: false, kind: 'manual_review' })]))).toBe(
      'No step in this workflow needs a binding.',
    );
  });

  it('says so when the only steps present never need one', () => {
    expect(summarizeBindings(bindings([entry({ stepId: 'open', kind: 'navigate' })]))).toBe(
      'No step in this workflow needs a binding.',
    );
  });

  it('says nothing when bindings could not be loaded', () => {
    expect(summarizeBindings(null)).toBeNull();
  });
});

describe('isFullyApproved', () => {
  it('is true only when every bindable step is approved and none is stale', () => {
    expect(isFullyApproved(bindings([entry({ status: 'approved' })]))).toBe(true);
    expect(isFullyApproved(bindings([entry({ status: 'approved', stale: true })]))).toBe(false);
    expect(isFullyApproved(bindings([entry({ status: 'draft' })]))).toBe(false);
  });

  it('is false for a workflow with nothing to bind', () => {
    // "Nothing to do" is not the same claim as "everything done".
    expect(isFullyApproved(bindings([entry({ bindable: false, kind: 'manual_review' })]))).toBe(
      false,
    );
  });

  it('is false when bindings could not be loaded', () => {
    expect(isFullyApproved(null)).toBe(false);
  });
});

describe('canBindStep', () => {
  function row(overrides: Partial<SopStepBindingView> = {}) {
    const [first] = bindingRows(
      [reviewStep({ id: overrides.stepId ?? 'sign_in', kind: overrides.kind ?? 'click' })],
      bindings([entry(overrides)]),
    );

    if (first === undefined) {
      throw new Error('the fixture should produce one row');
    }

    return first;
  }

  it('offers binding for a step nobody has demonstrated', () => {
    expect(canBindStep(row())).toBe(true);
    expect(bindActionLabel(row())).toBe('Bind this step');
  });

  it('offers binding again for an approved binding whose step has since changed', () => {
    // "Approved" and "usable" are different facts, and this is the case where
    // they differ: a stale binding is approved and must not be run.
    expect(canBindStep(row({ status: 'approved', stale: true }))).toBe(true);
    expect(bindActionLabel(row({ status: 'approved', stale: true }))).toBe('Bind this step again');
  });

  it('offers nothing more for an approved, up-to-date binding', () => {
    expect(canBindStep(row({ status: 'approved' }))).toBe(false);
  });

  it('offers binding for a recorded binding that has not been approved', () => {
    expect(canBindStep(row({ status: 'draft' }))).toBe(true);
  });

  it('offers nothing for a step a browser cannot perform', () => {
    expect(canBindStep(row({ kind: 'manual_review', bindable: false }))).toBe(false);
    // Not a refusal about automation — a navigate step compiles from the
    // workflow's own URL, and an outcome step is not compiled at all today.
    expect(canBindStep(row({ kind: 'navigate' }))).toBe(false);
    expect(canBindStep(row({ kind: 'outcome' }))).toBe(false);
  });
});

describe('needsHumanReview', () => {
  function row(overrides: Partial<SopStepBindingView> = {}) {
    const [first] = bindingRows(
      [reviewStep({ id: overrides.stepId ?? 'sign_in', kind: overrides.kind ?? 'click' })],
      bindings([entry(overrides)]),
    );

    if (first === undefined) {
      throw new Error('the fixture should produce one row');
    }

    return first;
  }

  it('offers review for a binding recorded but not yet submitted', () => {
    expect(needsHumanReview(row({ status: 'draft' }))).toBe(true);
  });

  it('offers review for a binding waiting on someone to decide', () => {
    expect(needsHumanReview(row({ status: 'needs_review' }))).toBe(true);
  });

  it('offers nothing once a binding is approved -- it was already reviewed', () => {
    // Every binding demonstrated through this panel is approved in the same
    // sitting, so an approved row is never something left for someone else.
    expect(needsHumanReview(row({ status: 'approved' }))).toBe(false);
  });

  it('offers nothing for a rejected binding -- the decision was already made', () => {
    expect(needsHumanReview(row({ status: 'rejected' }))).toBe(false);
  });

  it('offers nothing for a step with no binding at all', () => {
    expect(needsHumanReview(row())).toBe(false);
  });
});

describe('isFullyBoundForPublish', () => {
  it('is true when every step the compiler needs a binding for has a usable one', () => {
    expect(
      isFullyBoundForPublish(
        bindings([
          entry({ stepId: 'sign_in', kind: 'click', status: 'approved' }),
          entry({ stepId: 'enter_request_number', kind: 'fill', status: 'approved' }),
          // Neither of these needs a binding, and neither may block publishing.
          entry({ stepId: 'open_portal', kind: 'navigate', status: null }),
          entry({ stepId: 'escalate', kind: 'manual_review', bindable: false, status: null }),
        ]),
      ),
    ).toBe(true);
  });

  it('is false while one required step is unbound, stale, or unapproved', () => {
    const cases: readonly Partial<SopStepBindingView>[] = [
      { status: null },
      { status: 'draft' },
      { status: 'approved', stale: true },
      { status: 'approved', issues: [{ code: 'UNDECLARED_VARIABLE', message: 'no such name' }] },
    ];

    for (const overrides of cases) {
      expect(
        isFullyBoundForPublish(
          bindings([
            entry({ stepId: 'sign_in', kind: 'click', status: 'approved' }),
            entry({ stepId: 'enter_request_number', kind: 'fill', ...overrides }),
          ]),
        ),
      ).toBe(false);
    }
  });

  it('is false for a workflow with nothing the compiler needs bound', () => {
    // "Nothing to do" is not the same claim as "ready to publish".
    expect(isFullyBoundForPublish(bindings([entry({ kind: 'navigate', status: null })]))).toBe(
      false,
    );
  });

  it('is false when bindings could not be loaded', () => {
    expect(isFullyBoundForPublish(null)).toBe(false);
  });
});

describe('a call step, which is mapped rather than demonstrated', () => {
  it('needs a binding, unlike navigate and outcome', () => {
    // The actual bug this closes: `call` used to fall through the same branch
    // as `navigate`/`outcome` and read as "No binding needed" while the
    // compiler refused to publish it with `missing_binding`.
    expect(isBindingRequired({ kind: 'call', bindable: true })).toBe(true);
    expect(needsCallMapping('call')).toBe(true);
  });

  it('reports "Not mapped" rather than "Not recorded" or "No binding needed"', () => {
    const status = describeBindingStatus(entry({ kind: 'call', bindable: true, status: null }));
    expect(status.label).toBe('Not mapped');
    expect(status.detail).not.toMatch(/demonstrat/i);
  });

  it('offers no browser-session bind button, since there is nothing to demonstrate', () => {
    expect(
      canBindStep({
        stepId: 'lookup',
        position: 1,
        label: 'Look up the item',
        kind: 'call',
        status: describeBindingStatus(entry({ kind: 'call', status: null })),
        binding: entry({ kind: 'call', status: null }),
      }),
    ).toBe(false);
  });

  it('blocks isFullyBoundForPublish until it is mapped and approved', () => {
    // The publish-gate half of the same bug: a workflow with an unmapped call
    // step used to read as fully bound because `call` was excluded from the
    // required set entirely.
    expect(
      isFullyBoundForPublish(bindings([entry({ kind: 'call', bindable: true, status: null })])),
    ).toBe(false);

    expect(
      isFullyBoundForPublish(
        bindings([entry({ kind: 'call', bindable: true, status: 'approved', stale: false })]),
      ),
    ).toBe(true);
  });
});

describe('recovery proposals in the binding panel', () => {
  function proposal(overrides: Partial<RecoveryProposalView> = {}): RecoveryProposalView {
    return {
      proposalId: 'recprop_1',
      stepId: 'search_catalog',
      state: 'proposed',
      origin: 'drift',
      replacesBindingId: 'execbind_1',
      observedInRunId: 'run_1',
      summary: 'The test id changed; the button did not.',
      confidence: 'high',
      deterministic: true,
      before: [{ strategy: 'test_id', value: 'catalog-search-button', name: null }],
      after: [{ strategy: 'role_and_name', value: 'button', name: 'Search' }],
      approvedFingerprint: {
        role: 'button',
        accessibleName: 'Search',
        text: 'Search',
        width: null,
        height: null,
      },
      proposedAt: '2026-09-07T10:00:00.000Z',
      ...overrides,
    };
  }

  it('leads with what changed rather than with the mechanism', () => {
    // "Selector chain updated" is true and useless. The reader is deciding
    // whether this is the same button, so the headline has to be about that.
    expect(describeProposal(proposal()).headline).toContain('element changed');
  });

  it('renders both sides so accepting is a comparison, not a leap of faith', () => {
    const summary = describeProposal(proposal());

    expect(summary.before).toBe('test_id=catalog-search-button');
    expect(summary.after).toBe('role_and_name=button "Search"');
  });

  it('says out loud whether a model was involved', () => {
    // A reader should not need to know when — or whether — ranking was ever
    // switched on to know which kind of proposal they are looking at.
    expect(describeProposal(proposal()).provenance).toContain('No model was involved');
    expect(describeProposal(proposal({ deterministic: false })).provenance).toContain(
      'Ranked by a model',
    );
  });

  it('matches a proposal to its own step and to no other', () => {
    const proposals = [proposal()];

    expect(proposalForStep(proposals, 'search_catalog')?.proposalId).toBe('recprop_1');
    expect(proposalForStep(proposals, 'enter_isbn')).toBeNull();
  });
});
