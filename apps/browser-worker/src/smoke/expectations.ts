import type { ArtifactKind, BusinessOutcome, EventType, RunStatus } from '@orbit/contracts';

/**
 * What a smoke run must be able to show afterwards, and the checking of it.
 *
 * Kept pure and separate from the CLI that produces the evidence, so the
 * interesting cases — a run that succeeded but recorded no trace, a run that
 * reached the right status by the wrong path — are unit-testable without a
 * database, a browser or a portal.
 *
 * The lists below are the Phase 1 evidence requirement stated as code. If
 * CLAUDE.md's required-event list and this file ever disagree, one of them is
 * wrong and the failure says which event was missing.
 */

/** Events every successful run of any Phase 1 agent must have appended. */
export const CORE_EVENT_TYPES: readonly EventType[] = [
  'run.queued',
  'run.started',
  'run.completed',
  'step.started',
  'step.completed',
  'browser.navigation.completed',
  'browser.fill.completed',
  'browser.click.completed',
  'artifact.created',
];

/** Events that must never appear on a run this check calls healthy. */
export const FORBIDDEN_EVENT_TYPES: readonly EventType[] = [
  'run.failed',
  'step.failed',
  'assertion.failed',
];

/**
 * Artifact kinds every run must produce.
 *
 * A trace is required for *every* run, not only a failing one, so it is checked
 * unconditionally rather than treated as a nice-to-have.
 */
export const REQUIRED_ARTIFACT_KINDS: readonly ArtifactKind[] = [
  'browser_screenshot',
  'dom_snapshot',
  'browser_trace',
];

export interface SmokeScenario {
  readonly name: string;
  readonly requestNumber: string;
  readonly expectedStatus: RunStatus;
  readonly expectedOutcome: BusinessOutcome;
  /** Outputs that must be present with exactly these values. */
  readonly expectedOutputs: Readonly<Record<string, string>>;
  /** Events this scenario requires on top of the core list. */
  readonly additionalEventTypes: readonly EventType[];
}

/**
 * The two documented Phase 1 scenarios.
 *
 * The second is the one worth having: `SR-9999` is a **succeeded** run with the
 * business outcome `request_not_found`. A smoke test that only checked the
 * happy path would pass just as well against a build that had collapsed the
 * distinction between a technical status and a business conclusion, which is
 * most of what Orbit is for (ADR-006).
 */
export const FOUND_SCENARIO: SmokeScenario = {
  name: 'request found',
  requestNumber: 'SR-1001',
  expectedStatus: 'succeeded',
  expectedOutcome: 'request_found',
  expectedOutputs: {
    requestNumber: 'SR-1001',
    requestStatus: 'In Progress',
    assignedTeam: 'Infrastructure Operations',
  },
  // Only the found branch asserts and extracts; the not-found branch completes
  // straight from `expect_one_of`.
  additionalEventTypes: ['assertion.passed', 'browser.extract.completed'],
};

export const NOT_FOUND_SCENARIO: SmokeScenario = {
  name: 'request not found',
  requestNumber: 'SR-9999',
  expectedStatus: 'succeeded',
  expectedOutcome: 'request_not_found',
  expectedOutputs: { requestNumber: 'SR-9999' },
  additionalEventTypes: [],
};

/** Evidence read back out of the database, not the in-memory run result. */
export interface PersistedEvidence {
  readonly runId: string;
  readonly status: RunStatus;
  readonly businessOutcome: BusinessOutcome;
  readonly outputs: Readonly<Record<string, unknown>> | null;
  readonly stepCount: number;
  readonly eventTypes: readonly EventType[];
  readonly artifactKinds: readonly ArtifactKind[];
}

export interface EvidenceProblem {
  readonly check: string;
  readonly detail: string;
}

/**
 * Checks persisted evidence against a scenario.
 *
 * Every problem is collected rather than thrown at the first one: when a smoke
 * run goes wrong, the whole list is far more useful than whichever check
 * happened to be written first.
 */
export function checkEvidence(
  scenario: SmokeScenario,
  evidence: PersistedEvidence,
): readonly EvidenceProblem[] {
  const problems: EvidenceProblem[] = [];

  if (evidence.status !== scenario.expectedStatus) {
    problems.push({
      check: 'run status',
      detail: `expected "${scenario.expectedStatus}", found "${evidence.status}".`,
    });
  }

  if (evidence.businessOutcome !== scenario.expectedOutcome) {
    problems.push({
      check: 'business outcome',
      detail: `expected "${scenario.expectedOutcome}", found "${evidence.businessOutcome}".`,
    });
  }

  for (const [key, expected] of Object.entries(scenario.expectedOutputs)) {
    const actual = evidence.outputs?.[key];

    if (actual !== expected) {
      problems.push({
        check: `output ${key}`,
        detail: `expected "${expected}", found ${actual === undefined ? 'nothing' : `"${String(actual)}"`}.`,
      });
    }
  }

  if (evidence.stepCount === 0) {
    problems.push({ check: 'steps', detail: 'no run steps were persisted.' });
  }

  const seenEvents = new Set(evidence.eventTypes);

  for (const type of [...CORE_EVENT_TYPES, ...scenario.additionalEventTypes]) {
    if (!seenEvents.has(type)) {
      problems.push({ check: 'events', detail: `required event "${type}" was never appended.` });
    }
  }

  for (const type of FORBIDDEN_EVENT_TYPES) {
    if (seenEvents.has(type)) {
      problems.push({
        check: 'events',
        detail: `event "${type}" was appended on a run reported as healthy.`,
      });
    }
  }

  const seenArtifacts = new Set(evidence.artifactKinds);

  for (const kind of REQUIRED_ARTIFACT_KINDS) {
    if (!seenArtifacts.has(kind)) {
      problems.push({ check: 'artifacts', detail: `no "${kind}" artifact was persisted.` });
    }
  }

  return problems;
}
