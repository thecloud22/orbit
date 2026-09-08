import type { ArtifactKind, EventType } from '@orbit/contracts';
import { describe, expect, it } from 'vitest';

import {
  checkEvidence,
  CORE_EVENT_TYPES,
  FOUND_SCENARIO,
  NOT_FOUND_SCENARIO,
  REQUIRED_ARTIFACT_KINDS,
  type PersistedEvidence,
} from './expectations';

const ALL_ARTIFACTS: readonly ArtifactKind[] = REQUIRED_ARTIFACT_KINDS;

function healthyFound(overrides: Partial<PersistedEvidence> = {}): PersistedEvidence {
  return {
    runId: 'run_smoke',
    status: 'succeeded',
    businessOutcome: 'request_found',
    outputs: {
      requestNumber: 'SR-1001',
      requestStatus: 'In Progress',
      assignedTeam: 'Infrastructure Operations',
    },
    stepCount: 7,
    eventTypes: [
      ...CORE_EVENT_TYPES,
      'assertion.passed',
      'browser.extract.completed',
    ] as EventType[],
    artifactKinds: ALL_ARTIFACTS,
    ...overrides,
  };
}

function healthyNotFound(overrides: Partial<PersistedEvidence> = {}): PersistedEvidence {
  return {
    runId: 'run_smoke',
    status: 'succeeded',
    businessOutcome: 'request_not_found',
    outputs: { requestNumber: 'SR-9999' },
    stepCount: 5,
    eventTypes: [...CORE_EVENT_TYPES],
    artifactKinds: ALL_ARTIFACTS,
    ...overrides,
  };
}

describe('checkEvidence', () => {
  it('passes a healthy found run', () => {
    expect(checkEvidence(FOUND_SCENARIO, healthyFound())).toEqual([]);
  });

  it('passes a healthy not-found run', () => {
    expect(checkEvidence(NOT_FOUND_SCENARIO, healthyNotFound())).toEqual([]);
  });

  it('accepts that a not-found run neither asserts nor extracts', () => {
    // The not-found branch completes straight from `expect_one_of`, so requiring
    // the found branch's events here would fail a perfectly correct run.
    const problems = checkEvidence(NOT_FOUND_SCENARIO, healthyNotFound());

    expect(problems.map((problem) => problem.detail).join()).not.toContain(
      'browser.extract.completed',
    );
  });

  it('rejects a failed run', () => {
    const problems = checkEvidence(FOUND_SCENARIO, healthyFound({ status: 'failed' }));

    expect(problems).toContainEqual({
      check: 'run status',
      detail: 'expected "succeeded", found "failed".',
    });
  });

  // The distinction the product is built on: a not-found lookup is a *succeeded*
  // run. A build that reported it as failed would still reach a terminal state,
  // and only this check would notice.
  it('rejects a not-found lookup reported as a technical failure', () => {
    const problems = checkEvidence(
      NOT_FOUND_SCENARIO,
      healthyNotFound({
        status: 'failed',
        eventTypes: ['run.queued', 'run.started', 'run.failed'],
      }),
    );

    expect(problems.some((problem) => problem.check === 'run status')).toBe(true);
    expect(problems.some((problem) => problem.detail.includes('"run.failed" was appended'))).toBe(
      true,
    );
  });

  it('rejects the right status reached with the wrong business outcome', () => {
    const problems = checkEvidence(
      FOUND_SCENARIO,
      healthyFound({ businessOutcome: 'request_not_found' }),
    );

    expect(problems).toContainEqual({
      check: 'business outcome',
      detail: 'expected "request_found", found "request_not_found".',
    });
  });

  it('rejects a run whose extracted values are wrong', () => {
    const problems = checkEvidence(
      FOUND_SCENARIO,
      healthyFound({
        outputs: {
          requestNumber: 'SR-1001',
          requestStatus: 'Closed',
          assignedTeam: 'Infrastructure Operations',
        },
      }),
    );

    expect(problems).toContainEqual({
      check: 'output requestStatus',
      detail: 'expected "In Progress", found "Closed".',
    });
  });

  it('rejects a run with no outputs at all', () => {
    const problems = checkEvidence(FOUND_SCENARIO, healthyFound({ outputs: null }));

    expect(problems.filter((problem) => problem.check.startsWith('output'))).toHaveLength(3);
  });

  it('rejects a run that persisted no steps', () => {
    const problems = checkEvidence(FOUND_SCENARIO, healthyFound({ stepCount: 0 }));

    expect(problems).toContainEqual({ check: 'steps', detail: 'no run steps were persisted.' });
  });

  it('names every missing required event', () => {
    const problems = checkEvidence(
      FOUND_SCENARIO,
      healthyFound({
        eventTypes: CORE_EVENT_TYPES.filter(
          (type) => type !== 'artifact.created' && type !== 'browser.click.completed',
        ),
      }),
    );

    const details = problems.map((problem) => problem.detail);

    expect(details).toContain('required event "artifact.created" was never appended.');
    expect(details).toContain('required event "browser.click.completed" was never appended.');
  });

  // Every run gets a trace, not only a failing one. A green smoke test that
  // silently stopped producing traces would hide the loss of the one artifact
  // that reconstructs an execution.
  it('rejects a successful run that recorded no trace', () => {
    const problems = checkEvidence(
      FOUND_SCENARIO,
      healthyFound({ artifactKinds: ['browser_screenshot', 'dom_snapshot'] }),
    );

    expect(problems).toContainEqual({
      check: 'artifacts',
      detail: 'no "browser_trace" artifact was persisted.',
    });
  });

  it('collects every problem rather than stopping at the first', () => {
    const problems = checkEvidence(
      FOUND_SCENARIO,
      healthyFound({
        status: 'failed',
        businessOutcome: 'none',
        stepCount: 0,
        eventTypes: [],
        artifactKinds: [],
      }),
    );

    expect(problems.length).toBeGreaterThan(5);
    expect(new Set(problems.map((problem) => problem.check)).size).toBeGreaterThan(3);
  });
});
