import type { ArtifactView, RunDetailView, RunEventView, RunStepView } from '@orbit/api/views';
import { describe, expect, it } from 'vitest';

import {
  buildRunTimeline,
  describeBranch,
  formatDuration,
  humanizeEventType,
  humanizeLocator,
  stepDetails,
} from './run-timeline-view-model';

function step(overrides: Partial<RunStepView> = {}): RunStepView {
  return {
    id: 'runstep_1',
    agentStepId: 'open_request_portal',
    stepType: 'browser.navigate',
    sequence: 1,
    attempt: 1,
    status: 'succeeded',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.500Z',
    output: null,
    error: null,
    ...overrides,
  };
}

function event(overrides: Partial<RunEventView> = {}): RunEventView {
  return {
    id: 'evt_1',
    sequence: 1,
    eventType: 'step.started',
    occurredAt: '2026-01-01T00:00:00.000Z',
    runStepId: 'runstep_1',
    agentStepId: 'open_request_portal',
    payload: {},
    artifactRefs: [],
    ...overrides,
  };
}

function artifact(overrides: Partial<ArtifactView> = {}): ArtifactView {
  return {
    id: 'art_1',
    kind: 'browser_screenshot',
    contentType: 'image/png',
    sizeBytes: 2048,
    sha256: 'a'.repeat(64),
    createdAt: '2026-01-01T00:00:01.000Z',
    runStepId: 'runstep_1',
    roles: ['screenshot_after_action'],
    url: '/v1/runs/run_1/artifacts/art_1',
    ...overrides,
  };
}

function run(overrides: Partial<RunDetailView> = {}): RunDetailView {
  return {
    id: 'run_1',
    status: 'succeeded',
    businessOutcome: 'request_found',
    agentVersionId: 'agentv_1',
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:05.000Z',
    agentVersion: { id: 'agentv_1', name: 'Find Service Request', version: '0.1.0' },
    trigger: 'manual',
    inputs: { requestNumber: 'SR-1001' },
    outputs: null,
    error: null,
    steps: [],
    events: [],
    artifacts: [],
    ...overrides,
  } as RunDetailView;
}

describe('buildRunTimeline', () => {
  it('attaches each event and artifact to the step it names', () => {
    const timeline = buildRunTimeline(
      run({
        steps: [step(), step({ id: 'runstep_2', agentStepId: 'enter_number', sequence: 2 })],
        events: [
          event({ id: 'evt_1', sequence: 1, runStepId: 'runstep_1' }),
          event({ id: 'evt_2', sequence: 2, runStepId: 'runstep_2' }),
        ],
        artifacts: [
          artifact({ id: 'art_1', runStepId: 'runstep_1' }),
          artifact({ id: 'art_2', runStepId: 'runstep_2' }),
        ],
      }),
    );

    expect(timeline.steps.map((entry) => entry.step.id)).toEqual(['runstep_1', 'runstep_2']);
    expect(timeline.steps[0]?.events.map((e) => e.id)).toEqual(['evt_1']);
    expect(timeline.steps[1]?.evidence.map((e) => e.id)).toEqual(['art_2']);
  });

  it('keeps run-level events in their own group rather than mixed into the steps', () => {
    // `run.started` between two steps read as though it were one of them.
    const timeline = buildRunTimeline(
      run({
        steps: [step()],
        events: [
          event({
            id: 'evt_run',
            sequence: 1,
            eventType: 'run.started',
            runStepId: null,
            agentStepId: null,
          }),
          event({ id: 'evt_step', sequence: 2, runStepId: 'runstep_1' }),
        ],
      }),
    );

    expect(timeline.runEvents.map((e) => e.id)).toEqual(['evt_run']);
    expect(timeline.steps[0]?.events.map((e) => e.id)).toEqual(['evt_step']);
  });

  it('gives run-level evidence a place rather than dropping or misattributing it', () => {
    // The Playwright trace covers the whole session and belongs to no step.
    const timeline = buildRunTimeline(
      run({
        steps: [step()],
        artifacts: [artifact({ id: 'art_trace', kind: 'browser_trace', runStepId: null })],
      }),
    );

    expect(timeline.runEvidence.map((e) => e.id)).toEqual(['art_trace']);
    expect(timeline.steps[0]?.evidence).toEqual([]);
  });

  it('loses no event and no artifact in the join', () => {
    const source = run({
      steps: [step(), step({ id: 'runstep_2', sequence: 2 })],
      events: [
        event({ id: 'a', sequence: 1, runStepId: 'runstep_1' }),
        event({ id: 'b', sequence: 2, runStepId: null }),
        event({ id: 'c', sequence: 3, runStepId: 'runstep_2' }),
        // An event naming a step that is not in this run's step list. It must
        // still be reachable somewhere rather than silently vanishing.
        event({ id: 'd', sequence: 4, runStepId: 'runstep_missing' }),
      ],
      artifacts: [artifact({ id: 'x' }), artifact({ id: 'y', runStepId: null })],
    });

    const timeline = buildRunTimeline(source);
    const placed = [
      ...timeline.runEvents.map((e) => e.id),
      ...timeline.steps.flatMap((entry) => entry.events.map((e) => e.id)),
    ];

    // 'd' is deliberately not placed under a step, which is why the raw stream
    // is kept: the timeline is a reading aid, not the record.
    expect(placed).toEqual(['b', 'a', 'c']);
    expect(source.events).toHaveLength(4);

    const evidence = [
      ...timeline.runEvidence.map((e) => e.id),
      ...timeline.steps.flatMap((entry) => entry.evidence.map((e) => e.id)),
    ].sort();
    expect(evidence).toEqual(['x', 'y']);
  });

  it('orders by sequence, not by timestamp', () => {
    // Sequence is the ordering authority in the evidence contract; timestamps
    // can tie.
    const timeline = buildRunTimeline(
      run({
        steps: [
          step({ id: 'runstep_2', sequence: 2, startedAt: '2026-01-01T00:00:00.000Z' }),
          step({ id: 'runstep_1', sequence: 1, startedAt: '2026-01-01T00:00:00.000Z' }),
        ],
        events: [
          event({ id: 'second', sequence: 2, runStepId: null }),
          event({ id: 'first', sequence: 1, runStepId: null }),
        ],
      }),
    );

    expect(timeline.steps.map((entry) => entry.step.id)).toEqual(['runstep_1', 'runstep_2']);
    expect(timeline.runEvents.map((e) => e.id)).toEqual(['first', 'second']);
  });

  it('reports a step duration when both ends were recorded', () => {
    const timeline = buildRunTimeline(run({ steps: [step()] }));

    expect(timeline.steps[0]?.durationLabel).toBe('1.5s');
  });
});

describe('describeBranch', () => {
  it('names the branch a decision took, rather than its index', () => {
    const branch = describeBranch(
      step({
        stepType: 'browser.expect_one_of',
        output: {
          selectedAlternativeIndex: 1,
          matchedLocator: 'test_id=request-not-found',
          next: 'complete_not_found',
        },
      }),
    );

    expect(branch).toEqual({
      matched: 'request not found',
      next: 'complete_not_found',
      index: 1,
    });
  });

  it('reads the library demo branch the same way', () => {
    const branch = describeBranch(
      step({
        stepType: 'browser.expect_one_of',
        output: {
          selectedAlternativeIndex: 0,
          matchedLocator: 'test_id=copy-available',
          next: 'borrow_the_title',
        },
      }),
    );

    expect(branch?.matched).toBe('copy available');
    expect(branch?.next).toBe('borrow_the_title');
  });

  it('is null for a step that did not choose anything', () => {
    expect(describeBranch(step())).toBeNull();
    expect(describeBranch(step({ output: { locator: 'test_id=search' } }))).toBeNull();
  });

  it('is null rather than half-described when the output is incomplete', () => {
    expect(describeBranch(step({ output: { selectedAlternativeIndex: 0 } }))).toBeNull();
  });
});

describe('humanizeLocator', () => {
  it('drops the strategy and reads the target as words', () => {
    expect(humanizeLocator('test_id=request-not-found')).toBe('request not found');
    expect(humanizeLocator('test_id=assigned_team')).toBe('assigned team');
  });

  it('leaves a locator with no strategy prefix alone but still readable', () => {
    expect(humanizeLocator('request-result')).toBe('request result');
  });
});

describe('humanizeEventType', () => {
  it('drops the browser prefix and reads as a phrase', () => {
    expect(humanizeEventType('browser.navigation.completed')).toBe('navigation completed');
    expect(humanizeEventType('assertion.passed')).toBe('assertion passed');
    expect(humanizeEventType('run.queued')).toBe('run queued');
  });
});

describe('formatDuration', () => {
  it('uses milliseconds below a second and seconds above', () => {
    expect(formatDuration('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.250Z')).toBe('250ms');
    expect(formatDuration('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:02.000Z')).toBe('2.0s');
  });

  it('reports nothing rather than a guess when an end is missing', () => {
    expect(formatDuration('2026-01-01T00:00:00.000Z', null)).toBeNull();
    expect(formatDuration(null, '2026-01-01T00:00:00.000Z')).toBeNull();
  });

  it('reports nothing for an impossible interval rather than a negative one', () => {
    expect(formatDuration('2026-01-01T00:00:02.000Z', '2026-01-01T00:00:00.000Z')).toBeNull();
  });
});

describe('stepDetails', () => {
  it('renders a step output as labelled rows', () => {
    expect(stepDetails(step({ output: { assignedTeam: 'Infrastructure Operations' } }))).toEqual([
      { key: 'assignedTeam', label: 'Assigned team', value: 'Infrastructure Operations' },
    ]);
  });

  it('does not repeat the branch fields the timeline already renders as a branch', () => {
    const rows = stepDetails(
      step({
        output: {
          selectedAlternativeIndex: 1,
          matchedLocator: 'test_id=request-not-found',
          next: 'complete_not_found',
        },
      }),
    );

    expect(rows).toEqual([]);
  });

  it('is empty for a step that produced no output', () => {
    expect(stepDetails(step())).toEqual([]);
  });

  it('flattens a nested output rather than printing JSON at the reader', () => {
    // A `complete` step carries {outcome, outputs}. Rendering `outputs`
    // literally put `{"requestNumber":"SR-1002"}` on the page.
    expect(
      stepDetails(
        step({
          stepType: 'complete',
          output: { outcome: 'request_not_found', outputs: { requestNumber: 'SR-1002' } },
        }),
      ),
    ).toEqual([
      { key: 'outcome', label: 'Outcome', value: 'request_not_found' },
      { key: 'outputs.requestNumber', label: 'Request number', value: 'SR-1002' },
    ]);
  });

  it('drops an empty nested object instead of rendering "Outputs {}"', () => {
    expect(stepDetails(step({ stepType: 'complete', output: { outputs: {} } }))).toEqual([]);
  });

  it('still renders a non-string scalar rather than dropping it', () => {
    expect(stepDetails(step({ output: { httpStatus: 200 } }))).toEqual([
      { key: 'httpStatus', label: 'Http status', value: '200' },
    ]);
  });
});
