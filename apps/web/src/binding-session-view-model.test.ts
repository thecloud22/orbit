import type {
  BindingSessionView,
  BindingTargetStepView,
  SopReviewStepView,
} from '@orbit/api/views';
import { describe, expect, it } from 'vitest';

import { ApiRequestError } from './api-client';
import {
  bindDisabledReason,
  captureInstruction,
  captureRows,
  DEFAULT_BINDING_START_URL,
  describeBindingSessionFailure,
  formFieldsFor,
  multiFieldWarning,
  suggestedStartUrl,
} from './binding-session-view-model';

function targetStep(overrides: Partial<BindingTargetStepView> = {}): BindingTargetStepView {
  return {
    stepId: 'enter_request_number',
    kind: 'fill',
    summary: 'Fill Request Number',
    mode: 'action',
    declaredValue: '${inputs.requestNumber}',
    sensitive: false,
    fields: [],
    ...overrides,
  };
}

function session(overrides: Partial<BindingSessionView> = {}): BindingSessionView {
  return {
    sessionId: 'bind_1',
    documentId: 'sopdoc_1',
    startUrl: 'http://localhost:3001/requests',
    currentUrl: 'http://localhost:3001/requests',
    startedAt: '2026-09-07T10:00:00.000Z',
    step: targetStep(),
    captures: [],
    failures: [],
    ...overrides,
  };
}

const CAPTURE = {
  captureId: 'capture-1',
  kind: 'fill',
  description: 'Filled "Request number"',
  sensitive: false,
};

describe('captureRows', () => {
  it('is empty before the session has been read', () => {
    expect(captureRows(null)).toEqual([]);
  });

  it('offers each capture as something to choose between', () => {
    const rows = captureRows(session({ captures: [CAPTURE] }));

    expect(rows).toEqual([
      {
        captureId: 'capture-1',
        label: 'Filled "Request number"',
        kind: 'fill',
        sensitive: false,
      },
    ]);
  });
});

describe('captureInstruction', () => {
  it('asks for the action to be performed for a step that acts', () => {
    expect(captureInstruction(session())).toContain('Do this one step');
  });

  it('says the page will not react for a step that only reads', () => {
    const reading = session({ step: targetStep({ kind: 'extract', mode: 'pick' }) });
    expect(captureInstruction(reading)).toContain('will not react');
  });
});

describe('formFieldsFor', () => {
  it('states a fill’s declared value rather than asking for one', () => {
    expect(formFieldsFor(targetStep())).toMatchObject({
      declaredValue: '${inputs.requestNumber}',
      needsVariableChoice: false,
    });
  });

  it('needs no choice when an extract step reads exactly one value', () => {
    const fields = formFieldsFor(targetStep({ kind: 'extract', fields: ['status'] }));

    expect(fields.variableOptions).toEqual(['status']);
    expect(fields.needsVariableChoice).toBe(false);
  });

  it('needs a choice when an extract step reads several', () => {
    const fields = formFieldsFor(
      targetStep({ kind: 'extract', fields: ['status', 'assignedTeam'] }),
    );

    expect(fields.needsVariableChoice).toBe(true);
  });
});

describe('multiFieldWarning', () => {
  it('says nothing when one binding covers the step', () => {
    expect(multiFieldWarning(targetStep({ kind: 'extract', fields: ['status'] }))).toBeNull();
    expect(multiFieldWarning(targetStep())).toBeNull();
  });

  it('warns that one binding reads one element when the step reads several', () => {
    const warning = multiFieldWarning(
      targetStep({ kind: 'extract', fields: ['status', 'assignedTeam'] }),
    );

    expect(warning).toContain('one binding reads one element');
  });
});

describe('bindDisabledReason', () => {
  it('waits for the session before offering anything', () => {
    expect(
      bindDisabledReason({ session: null, selectedCaptureId: null, variable: null }),
    ).toContain('still opening');
  });

  it('waits for something to have been captured', () => {
    expect(
      bindDisabledReason({ session: session(), selectedCaptureId: null, variable: null }),
    ).toContain('Nothing has been captured');
  });

  it('asks which capture was the step', () => {
    expect(
      bindDisabledReason({
        session: session({ captures: [CAPTURE] }),
        selectedCaptureId: null,
        variable: null,
      }),
    ).toContain('Choose which capture');
  });

  it('asks which value a multi-field extract reads', () => {
    expect(
      bindDisabledReason({
        session: session({
          captures: [CAPTURE],
          step: targetStep({ kind: 'extract', fields: ['status', 'assignedTeam'] }),
        }),
        selectedCaptureId: 'capture-1',
        variable: null,
      }),
    ).toContain('which value');
  });

  it('is available once the capture is chosen and nothing else is missing', () => {
    expect(
      bindDisabledReason({
        session: session({ captures: [CAPTURE] }),
        selectedCaptureId: 'capture-1',
        variable: null,
      }),
    ).toBeNull();
  });
});

describe('describeBindingSessionFailure', () => {
  it('reports a closed session as unrecoverable', () => {
    const failure = describeBindingSessionFailure(
      new ApiRequestError({ status: 404, message: 'That binding session is not open.' }),
    );

    expect(failure.kind).toBe('gone');
    expect(failure.sessionSurvived).toBe(false);
  });

  it('says the browser survived a refused binding, with the reasons', () => {
    const failure = describeBindingSessionFailure(
      new ApiRequestError({
        status: 422,
        message: 'That binding was refused.',
        details: [{ field: 'binding', message: '[STALE_BINDING] The step changed.' }],
      }),
    );

    expect(failure.kind).toBe('refused');
    expect(failure.sessionSurvived).toBe(true);
    expect(failure.issues).toEqual(['[STALE_BINDING] The step changed.']);
  });

  it('names the window already open when a second session is refused', () => {
    const failure = describeBindingSessionFailure(
      new ApiRequestError({ status: 409, message: 'conflict' }),
    );

    expect(failure.kind).toBe('in_use');
    expect(failure.message).toContain('already open');
  });
});

describe('suggestedStartUrl', () => {
  function reviewStep(kind: string, step: Record<string, unknown>): SopReviewStepView {
    return {
      id: 'open_portal',
      kind,
      summary: 'Open the portal',
      position: 1,
      canMoveUp: false,
      canMoveDown: true,
      produces: [],
      step,
    };
  }

  it('takes the workflow’s own starting URL when it declares one', () => {
    expect(
      suggestedStartUrl([reviewStep('navigate', { urlHint: 'https://portal.example.com/login' })]),
    ).toBe('https://portal.example.com/login');
  });

  it('falls back to the local demo portal when nothing says where to start', () => {
    expect(suggestedStartUrl([reviewStep('click', { targetHint: 'Search' })])).toBe(
      DEFAULT_BINDING_START_URL,
    );
  });
});
