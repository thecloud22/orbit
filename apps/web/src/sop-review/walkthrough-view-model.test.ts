import type { WalkthroughSessionView, WalkthroughStepView } from '@orbit/api/views';
import { describe, expect, it } from 'vitest';

import { ApiRequestError } from '../api-client';
import {
  acceptableProposalIds,
  describeWalkthroughFailure,
  phaseOf,
  summarizeWalkthrough,
  walkthroughRows,
} from './walkthrough-view-model';

/**
 * The walkthrough review screen's judgements (ADR-035).
 *
 * The one that matters most is what a step with *no* proposal reads as. A
 * screen that shows six matched steps and three blanks, with no explanation
 * against the blanks, tells somebody the workflow is finished when it is not.
 */
function step(overrides: Partial<WalkthroughStepView> = {}): WalkthroughStepView {
  return {
    stepId: 'enter_isbn',
    stepKind: 'fill',
    summary: 'Fill Search the catalog',
    proposalId: 'recprop_1',
    state: 'proposed',
    demonstrated: 'Filled "Search the catalog"',
    refusal: null,
    message: null,
    ...overrides,
  };
}

function session(
  steps: readonly WalkthroughStepView[],
  overrides: Partial<WalkthroughSessionView> = {},
): WalkthroughSessionView {
  return {
    sessionId: 'walk_1',
    documentId: 'sopdoc_1',
    startUrl: 'http://localhost:3020/catalog',
    currentUrl: 'http://localhost:3020/catalog',
    startedAt: '2026-09-07T12:00:00.000Z',
    mode: 'action',
    browserOpen: false,
    awaitingBinding: steps.length,
    captures: [],
    failures: [],
    outcome: {
      steps,
      proposed: steps.filter((one) => one.proposalId !== null).length,
      unusedCaptures: 0,
    },
    ...overrides,
  };
}

describe('which half of the sitting a person is in', () => {
  it('is demonstrating until the walkthrough has been finished', () => {
    expect(phaseOf(session([], { outcome: null }))).toBe('demonstrating');
    expect(phaseOf(session([step()]))).toBe('reviewing');
  });
});

describe('a step the walkthrough accounted for', () => {
  it('offers accepting, and names the element rather than the selector', () => {
    const [row] = walkthroughRows(session([step()]));

    expect(row).toMatchObject({
      stepId: 'enter_isbn',
      tone: 'proposed',
      statusLabel: 'Proposed',
      acceptable: true,
      needsDemonstration: false,
    });
    expect(row?.detail).toBe('Filled "Search the catalog"');
  });

  it('stops offering acceptance once it has been accepted', () => {
    const [row] = walkthroughRows(session([step({ state: 'accepted' })]));

    expect(row).toMatchObject({ tone: 'accepted', acceptable: false, needsDemonstration: false });
    expect(row?.detail).toContain('approved mapping');
  });

  it('sends a dismissed step back to being demonstrated', () => {
    const [row] = walkthroughRows(session([step({ state: 'dismissed' })]));

    // Dismissing leaves the step unbound, so somebody still has to show it.
    expect(row).toMatchObject({ tone: 'dismissed', acceptable: false, needsDemonstration: true });
  });

  it('treats a proposal the database no longer has as gone, never as acceptable', () => {
    const [row] = walkthroughRows(session([step({ state: 'gone' })]));

    expect(row?.acceptable).toBe(false);
    expect(row?.needsDemonstration).toBe(true);
  });
});

describe('a step the walkthrough could not account for', () => {
  it('says why, in the server’s own words', () => {
    const [row] = walkthroughRows(
      session([
        step({
          stepId: 'check_availability',
          stepKind: 'decision',
          proposalId: null,
          state: null,
          demonstrated: null,
          refusal: 'decision_needs_each_branch',
          message: 'A decision has more than one outcome and a walkthrough follows one path.',
        }),
      ]),
    );

    expect(row).toMatchObject({
      tone: 'refused',
      statusLabel: 'Nothing proposed',
      acceptable: false,
      needsDemonstration: true,
    });
    expect(row?.detail).toContain('follows one path');
  });

  it('falls back to a sentence of its own when the server sent no message', () => {
    const [row] = walkthroughRows(
      session([
        step({
          proposalId: null,
          state: null,
          demonstrated: null,
          refusal: 'nothing_matched',
          message: null,
        }),
      ]),
    );

    expect(row?.detail).toContain('Demonstrate it on its own');
  });

  it('never claims a step is finished when nothing was proposed for it', () => {
    const rows = walkthroughRows(
      session([step({ proposalId: null, state: null, refusal: 'nothing_matched', message: null })]),
    );

    expect(rows.every((row) => row.tone !== 'accepted')).toBe(true);
  });
});

describe('accepting in bulk', () => {
  it('acts only on what is still waiting', () => {
    const view = session([
      step({ stepId: 'enter_isbn', proposalId: 'recprop_1', state: 'proposed' }),
      step({ stepId: 'search_catalog', proposalId: 'recprop_2', state: 'accepted' }),
      step({ stepId: 'borrow_title', proposalId: 'recprop_3', state: 'proposed' }),
      step({ stepId: 'place_hold', proposalId: null, state: null, refusal: 'nothing_matched' }),
    ]);

    expect(acceptableProposalIds(view)).toEqual(['recprop_1', 'recprop_3']);
  });

  it('has nothing to offer when everything is resolved', () => {
    expect(acceptableProposalIds(session([step({ state: 'accepted' })]))).toEqual([]);
  });
});

describe('the sentence at the top', () => {
  it('tells somebody what to do while they are still demonstrating', () => {
    const summary = summarizeWalkthrough(session([], { outcome: null, awaitingBinding: 9 }));

    expect(summary.headline).toContain('Perform the whole task');
    expect(summary.headline).toContain('9 steps');
  });

  it('states the shortfall as well as the win', () => {
    const summary = summarizeWalkthrough(
      session([
        step({ stepId: 'enter_isbn', proposalId: 'recprop_1' }),
        step({ stepId: 'place_hold', proposalId: null, state: null, refusal: 'nothing_matched' }),
      ]),
    );

    expect(summary.headline).toContain('1 step');
    expect(summary.detail).toContain('still need');
  });

  it('says plainly when nothing matched at all', () => {
    const summary = summarizeWalkthrough(
      session([step({ proposalId: null, state: null, refusal: 'nothing_matched' })]),
    );

    expect(summary.headline).toContain('could not match anything');
  });

  it('mentions interactions no step claimed', () => {
    const view = session([step()]);
    const summary = summarizeWalkthrough({
      ...view,
      outcome: { ...view.outcome!, unusedCaptures: 3 },
    });

    expect(summary.detail).toContain('3 interactions');
  });
});

describe('what went wrong', () => {
  it('reads a closed window as gone rather than as an error', () => {
    const failure = describeWalkthroughFailure(
      new ApiRequestError({ status: 410, message: 'The walkthrough browser was closed.' }),
    );

    expect(failure.kind).toBe('gone');
  });

  it('reads a session the API no longer holds as gone, and says work was kept', () => {
    const failure = describeWalkthroughFailure(
      new ApiRequestError({ status: 404, message: 'That walkthrough is not open.' }),
    );

    expect(failure.kind).toBe('gone');
    expect(failure.message).toContain('still saved');
  });

  it('distinguishes a second walkthrough from a failure', () => {
    // Keyed on the code, not the bare status: SESSION_ALREADY_OPEN is what the
    // server actually sends, and this must not fire for some other, unrelated
    // 409 that happens to share the status line.
    const failure = describeWalkthroughFailure(
      new ApiRequestError({
        status: 409,
        code: 'SESSION_ALREADY_OPEN',
        message: 'Already open.',
        details: [{ field: 'sessionId', message: 'walk_existing' }],
      }),
    );

    expect(failure.kind).toBe('conflict');
    expect(failure.existingSessionId).toBe('walk_existing');
  });

  it('does not treat an unrelated 409 as a session conflict', () => {
    const failure = describeWalkthroughFailure(
      new ApiRequestError({ status: 409, message: 'Some other conflict.' }),
    );

    expect(failure.kind).not.toBe('conflict');
  });

  it('passes a refusal through in the server’s own words', () => {
    const failure = describeWalkthroughFailure(
      new ApiRequestError({ status: 422, message: 'Nothing was demonstrated.' }),
    );

    expect(failure).toMatchObject({ kind: 'refused', message: 'Nothing was demonstrated.' });
  });
});
