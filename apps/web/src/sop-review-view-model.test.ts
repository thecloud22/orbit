import type { SopReviewView } from '@orbit/api/views';
import { describe, expect, it } from 'vitest';

import { ApiRequestError } from './api-client';
import {
  describeReviewFailure,
  EDITABLE_STEP_KINDS,
  fieldsForStepKind,
  pruneEmptyFields,
  reviewActions,
  stateLabel,
  submitBlockedReason,
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
    sandboxState: null,
    agentVersionId: null,
    agentVersion: null,
  },
  declaredOutcomes: [],
  reviewNote: null,
  reviewedAt: null,
  executable: false,
};

describe('reviewActions', () => {
  it('labels only the actions the server offered', () => {
    // The legal set is computed from SOP_REVISION_TRANSITIONS on the server;
    // this file may label them and nothing else.
    expect(reviewActions(REVIEW).map((action) => action.action)).toEqual([
      'request_clarification',
      'submit_for_review',
      'reject',
    ]);
    expect(reviewActions(REVIEW).map((action) => action.label)).toEqual([
      'Send back for clarification',
      'Submit for review',
      'Reject',
    ]);
  });

  it('offers nothing when the server offered nothing', () => {
    expect(reviewActions({ ...REVIEW, availableActions: [] })).toEqual([]);
  });

  it('passes through an action it has no label for rather than dropping it', () => {
    expect(reviewActions({ ...REVIEW, availableActions: ['some_future_action'] })[0]).toEqual({
      action: 'some_future_action',
      label: 'some_future_action',
      emphasis: 'secondary',
    });
  });
});

describe('submitBlockedReason', () => {
  it('explains the absent action rather than leaving a gap', () => {
    const blocked = submitBlockedReason({
      ...REVIEW,
      availableActions: ['request_clarification'],
      unansweredQuestionIds: ['q1', 'q2'],
    });

    expect(blocked).toBe(
      '2 clarification questions still need answers before this workflow can be reviewed.',
    );
  });

  it('uses the singular for one outstanding question', () => {
    expect(
      submitBlockedReason({
        ...REVIEW,
        availableActions: [],
        unansweredQuestionIds: ['q1'],
      }),
    ).toContain('One clarification question');
  });

  it('says nothing when the action is available', () => {
    expect(submitBlockedReason(REVIEW)).toBeNull();
  });

  it('says nothing when the action is absent for a reason other than questions', () => {
    // An approved revision offers no submit action, but that is not a blocked
    // submission and must not be reported as one.
    expect(
      submitBlockedReason({
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

describe('fieldsForStepKind', () => {
  it('covers every step kind in the vocabulary', () => {
    expect([...EDITABLE_STEP_KINDS].sort()).toEqual([
      'click',
      'decision',
      'extract',
      'fill',
      'manual_review',
      'navigate',
      'outcome',
    ]);
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
