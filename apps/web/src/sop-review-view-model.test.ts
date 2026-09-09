import type { SopBindingsView, SopStepBindingView } from '@orbit/api/views';
import type { SopReviewView } from '@orbit/api/views';
import { describe, expect, it } from 'vitest';

import { SOP_STEP_KINDS } from '@orbit/sop-graph';

import { ApiRequestError } from './api-client';
import {
  issuesWithoutRecovery,
  undeclaredInputRefs,
  EDITABLE_STEP_KINDS,
  STEP_KIND_LABELS,
  describeReviewFailure,
  fieldsForStepKind,
  pruneEmptyFields,
  publishBlockedReason,
  reviewLead,
  reviewPhase,
  reviseConfirmation,
  stateLabel,
  stepKindLabel,
} from './sop-review-view-model';

const REVIEW: SopReviewView = {
  documentId: 'sopdoc_1',
  documentTitle: 'Escalation review',
  revisionId: 'soprev_1',
  revisionNumber: 2,
  state: 'draft',
  parentRevisionId: null,
  title: 'Service request escalation review',
  description: null,
  steps: [],
  inputs: [],
  assumptions: [],
  clarifications: [],
  unansweredQuestionIds: [],
  risks: [],
  provenance: {
    kind: 'generated',
    provider: 'fake',
    model: 'fake',
    promptVersion: null,
    generatedAt: null,
  },
  availableActions: ['request_clarification', 'submit_for_review', 'reject'],
  editable: true,
  publication: {
    candidateId: null,
    candidateState: null,
    compiledFromRevisionId: null,
    sandboxState: null,
    agentVersionId: null,
    agentVersion: null,
  },
  declaredOutcomes: [],
  reviewNote: null,
  reviewedAt: null,
  executable: false,
};

describe('publishBlockedReason', () => {
  it('names the outstanding questions rather than letting publishing refuse later', () => {
    const blocked = publishBlockedReason({ ...REVIEW, unansweredQuestionIds: ['q1', 'q2'] });

    expect(blocked).toBe(
      '2 clarification questions still need answers before this workflow can be published.',
    );
  });

  it('uses the singular for one outstanding question', () => {
    expect(publishBlockedReason({ ...REVIEW, unansweredQuestionIds: ['q1'] })).toContain(
      'One clarification question',
    );
  });

  it('says nothing when every question has been answered', () => {
    expect(publishBlockedReason(REVIEW)).toBeNull();
  });

  it('reads the questions directly, not the lifecycle actions nobody is offered any more', () => {
    // No lifecycle action is on offer in the UI at all now (ADR-028), so an
    // empty `availableActions` must not by itself read as "blocked".
    expect(
      publishBlockedReason({
        ...REVIEW,
        state: 'approved',
        availableActions: [],
        unansweredQuestionIds: [],
      }),
    ).toBeNull();
  });
});

describe('stateLabel', () => {
  it('reads as English', () => {
    expect(stateLabel('needs_clarification')).toBe('Needs clarification');
    expect(stateLabel('in_review')).toBe('In review');
  });

  it('falls back to the raw state rather than showing nothing', () => {
    expect(stateLabel('something_new')).toBe('something_new');
  });
});

describe('describeReviewFailure', () => {
  it('treats a rejected change as its own kind and keeps the sentence', () => {
    const failure = describeReviewFailure(
      new ApiRequestError({
        status: 422,
        message:
          'Cannot move "Search the team directory" before "Extract request details" because the moved step uses Assigned Team, which is produced later in the workflow.',
        details: [{ field: 'steps.2', message: '[VARIABLE_NOT_AVAILABLE_ON_ALL_PATHS] …' }],
      }),
    );

    expect(failure.kind).toBe('rejected_change');
    expect(failure.message).toMatch(/^Cannot move /);
    expect(failure.issues.length).toBe(1);
  });

  it('separates a stale revision from a rejected change', () => {
    // Different response from the reader: reload, not rewrite.
    const failure = describeReviewFailure(
      new ApiRequestError({ status: 409, message: 'This revision is "approved".' }),
    );

    expect(failure.kind).toBe('conflict');
    expect(failure.title).toBe('This revision has moved on');
  });

  it('reports anything else as a request problem', () => {
    expect(describeReviewFailure(new ApiRequestError({ status: 400, message: 'Bad.' })).kind).toBe(
      'request_failed',
    );
  });
});

describe('undeclaredInputRefs', () => {
  it('finds the name from the real message the API sends', () => {
    // The exact wire shape: toIssueDetails() prefixes the code, and
    // @orbit/sop-graph's own sentence quotes the name. Pinned against the real
    // format rather than a shape invented for the test, since this is the
    // thing that broke: the information was already there, just unusable.
    const failure = describeReviewFailure(
      new ApiRequestError({
        status: 422,
        message: 'That edit would make the workflow invalid, so it was not saved.',
        details: [
          {
            field: 'steps.2.value',
            message:
              '[UNDECLARED_INPUT_REFERENCE] "Fill "Member ID"" uses the run input "memberId", which this workflow does not declare.',
          },
        ],
      }),
    );

    expect(undeclaredInputRefs(failure)).toEqual(['memberId']);
  });

  it('is empty for a failure that names no undeclared input', () => {
    const failure = describeReviewFailure(
      new ApiRequestError({
        status: 422,
        message: 'That edit would make the workflow invalid, so it was not saved.',
        details: [{ field: 'steps.1', message: '[STEP_ID_IMMUTABLE] cannot rename a step.' }],
      }),
    );

    expect(undeclaredInputRefs(failure)).toEqual([]);
  });

  it('does not repeat the same input twice', () => {
    const issue = {
      field: 'steps.2.value',
      message:
        '[UNDECLARED_INPUT_REFERENCE] uses the run input "memberId", which this workflow does not declare.',
    };
    const failure = describeReviewFailure(
      new ApiRequestError({ status: 422, message: 'Invalid.', details: [issue, issue] }),
    );

    expect(undeclaredInputRefs(failure)).toEqual(['memberId']);
  });
});

describe('issuesWithoutRecovery', () => {
  it('drops an undeclared-input issue, since the page shows a fix for it instead of the raw text', () => {
    const failure = describeReviewFailure(
      new ApiRequestError({
        status: 422,
        message: 'Invalid.',
        details: [
          {
            field: 'steps.2.value',
            message:
              '[UNDECLARED_INPUT_REFERENCE] uses the run input "memberId", which this workflow does not declare.',
          },
          { field: 'steps.1', message: '[STEP_ID_IMMUTABLE] cannot rename a step.' },
        ],
      }),
    );

    expect(issuesWithoutRecovery(failure)).toEqual([
      { where: 'steps.1', message: '[STEP_ID_IMMUTABLE] cannot rename a step.' },
    ]);
  });
});

describe('fieldsForStepKind', () => {
  /**
   * Kinds the SOP Graph defines that Studio deliberately does not offer, each
   * with its reason.
   *
   * Naming them is the point. A kind missing because nobody noticed and a kind
   * withheld on purpose look identical in the editor, and only one of them is
   * correct.
   */
  const WITHHELD: Readonly<Record<string, string>> = {};

  it('covers every step kind in the vocabulary', () => {
    // Derived from @orbit/sop-graph rather than restated. This assertion used to
    // compare against a hand-written list, so it claimed to cover the vocabulary
    // while never reading it -- and adding `call` to the graph left Studio
    // unable to author it with nothing failing.
    const offered = new Set<string>(EDITABLE_STEP_KINDS);

    expect(
      SOP_STEP_KINDS.filter((kind) => !offered.has(kind) && WITHHELD[kind] === undefined),
    ).toEqual([]);
  });

  it('offers nothing the SOP Graph does not define, and withholds nothing that has gone', () => {
    const defined = new Set<string>(SOP_STEP_KINDS);

    expect(EDITABLE_STEP_KINDS.filter((kind) => !defined.has(kind))).toEqual([]);
    // A stale entry would silently excuse a kind that had been renamed.
    expect(Object.keys(WITHHELD).filter((kind) => !defined.has(kind))).toEqual([]);
  });

  it('never offers a raw JSON field for any kind', () => {
    // The brief requires structured fields only.
    for (const kind of EDITABLE_STEP_KINDS) {
      for (const spec of fieldsForStepKind(kind)) {
        expect(spec.kind).not.toBe('json');
      }
    }
  });

  it('gives a decision its branches and the values it reads', () => {
    const names = fieldsForStepKind('decision').map((spec) => spec.name);
    expect(names).toEqual(['question', 'usesInputs', 'usesVariables', 'branches', 'purpose']);
  });

  it('gives a fill its value source and the secret marker', () => {
    const specs = fieldsForStepKind('fill');
    expect(specs.map((spec) => spec.name)).toContain('value');
    expect(specs.find((spec) => spec.name === 'sensitive')?.kind).toBe('boolean');
  });

  it('returns nothing for a kind it does not know, rather than guessing', () => {
    expect(fieldsForStepKind('teleport')).toEqual([]);
  });
});

describe('pruneEmptyFields', () => {
  it('drops an emptied optional field instead of sending an empty string', () => {
    // The graph schema is strict and these fields are `.min(1).optional()`, so
    // an empty string would be a schema error rather than "cleared".
    expect(
      pruneEmptyFields({ id: 'a', kind: 'navigate', urlHint: '   ', purpose: 'Open it' }),
    ).toEqual({
      id: 'a',
      kind: 'navigate',
      purpose: 'Open it',
    });
  });

  it('drops empty arrays and absent values', () => {
    expect(
      pruneEmptyFields({ id: 'a', usesInputs: [], produces: undefined, handoff: null }),
    ).toEqual({ id: 'a' });
  });

  it('keeps false, which is a real value', () => {
    expect(pruneEmptyFields({ id: 'a', sensitive: false })).toEqual({ id: 'a', sensitive: false });
  });
});

/** One step's binding row, defaulting to a step nobody has demonstrated. */
function bindingStep(overrides: Partial<SopStepBindingView> = {}): SopStepBindingView {
  return {
    stepId: 'search',
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

function bindings(steps: readonly SopStepBindingView[]): SopBindingsView {
  return {
    documentId: 'sopdoc_1',
    revisionId: 'soprev_1',
    steps,
    summary: {
      bindable: steps.filter((step) => step.bindable).length,
      bound: steps.filter((step) => step.status !== null).length,
      approved: steps.filter((step) => step.status === 'approved').length,
      stale: steps.filter((step) => step.stale).length,
    },
  };
}

const APPROVED = bindingStep({ status: 'approved' });

const PUBLISHED_AT_THIS_REVISION: SopReviewView = {
  ...REVIEW,
  editable: false,
  state: 'approved',
  publication: {
    candidateId: 'aircand_1',
    candidateState: 'approved',
    compiledFromRevisionId: REVIEW.revisionId,
    sandboxState: 'ready',
    agentVersionId: 'agentv_1',
    agentVersion: '0.1.0',
  },
};

describe('reviewPhase', () => {
  it('is drafting while a step still has to be shown to Orbit', () => {
    expect(reviewPhase(REVIEW, bindings([bindingStep()]))).toBe('drafting');
  });

  it('is drafting when the bindings could not be read at all', () => {
    // Unknown is not ready. Offering Publish on a failed fetch would offer an
    // action the server refuses.
    expect(reviewPhase(REVIEW, null)).toBe('drafting');
  });

  it('is ready once every step that needs a mapping has an approved one', () => {
    expect(reviewPhase(REVIEW, bindings([APPROVED]))).toBe('ready');
  });

  it('is not ready when an approved mapping has gone stale', () => {
    expect(reviewPhase(REVIEW, bindings([bindingStep({ status: 'approved', stale: true })]))).toBe(
      'drafting',
    );
  });

  it('is published whenever a version exists, whatever the revision looks like', () => {
    expect(reviewPhase(PUBLISHED_AT_THIS_REVISION, bindings([APPROVED]))).toBe('published');
  });

  it('stays published after the workflow has been revised', () => {
    // The case that makes the ordering load-bearing: a revised document is
    // published *and* editable *and* fully bound at the same time, and what a
    // reader needs told first is that something is still running (ADR-036).
    const revised: SopReviewView = {
      ...PUBLISHED_AT_THIS_REVISION,
      revisionId: 'soprev_2',
      revisionNumber: 3,
      editable: true,
      state: 'draft',
    };

    expect(reviewPhase(revised, bindings([APPROVED]))).toBe('published');
  });
});

describe('reviewLead', () => {
  it('counts what is still unmapped, in the drafting phase', () => {
    const lead = reviewLead(REVIEW, bindings([bindingStep(), bindingStep({ stepId: 'fill' })]));

    expect(lead.phase).toBe('drafting');
    expect(lead.body).toContain('2 steps');
  });

  it('says one step in the singular', () => {
    expect(reviewLead(REVIEW, bindings([bindingStep()])).body).toContain('One step');
  });

  it('does not count a step the compiler needs no mapping for', () => {
    const lead = reviewLead(
      REVIEW,
      bindings([APPROVED, bindingStep({ stepId: 'open', kind: 'navigate', bindable: true })]),
    );

    expect(lead.phase).toBe('ready');
  });

  it('admits it does not know when the bindings could not be read', () => {
    expect(reviewLead(REVIEW, null).body).toContain('could not read');
  });

  it('leads a published workflow with what is running', () => {
    const lead = reviewLead(PUBLISHED_AT_THIS_REVISION, bindings([APPROVED]));

    expect(lead.title).toBe('Running as version 0.1.0');
    expect(lead.body).toContain('none of it changes what is running now');
  });

  it('names the unpublished revision once a published workflow has been revised', () => {
    const revised: SopReviewView = {
      ...PUBLISHED_AT_THIS_REVISION,
      revisionId: 'soprev_2',
      revisionNumber: 3,
      editable: true,
    };

    const lead = reviewLead(revised, bindings([APPROVED]));

    expect(lead.title).toBe('Running as version 0.1.0');
    expect(lead.body).toContain('Revision 3 has not been published');
    expect(lead.body).toContain('keeps running');
  });
});

describe('reviseConfirmation', () => {
  it('answers the three things a person is right to fear before forking', () => {
    const confirmation = reviseConfirmation(PUBLISHED_AT_THIS_REVISION);

    // The approved revision is kept, the mappings are kept, and the running
    // version is untouched. All three are stated before the click, because none
    // of them is visible from the button (ADR-036).
    expect(confirmation.points[0]).toContain('revision 3');
    expect(confirmation.points[0]).toContain('Revision 2 is kept');
    expect(confirmation.points[1]).toContain('Every mapping already recorded is kept');
    expect(confirmation.points[2]).toContain('Version 0.1.0 keeps running');
    expect(confirmation.points[2]).toContain('until you publish again');
  });

  it('says what is true when nothing has been published yet', () => {
    expect(reviseConfirmation({ ...REVIEW, editable: false }).points[2]).toBe(
      'Nothing that is running changes until you publish again.',
    );
  });
});

describe('step kind labels', () => {
  it('names every kind a person can choose, in their words', () => {
    // The picker rendered the internal identifier until `call` arrived and said
    // nothing about an API. A missing label would silently fall back to the
    // identifier again, which is the failure this catches.
    const unlabelled = EDITABLE_STEP_KINDS.filter((kind) => STEP_KIND_LABELS[kind] === undefined);

    expect(unlabelled).toEqual([]);
    expect(stepKindLabel('call')).toBe('Call an API');
  });

  it('falls back to the identifier rather than to nothing', () => {
    expect(stepKindLabel('not_a_kind')).toBe('not_a_kind');
  });
});
