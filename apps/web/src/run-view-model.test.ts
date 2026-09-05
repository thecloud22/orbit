import type { ArtifactView, RunDetailView } from '@orbit/api/views';
import type { OrbitError } from '@orbit/contracts';
import { describe, expect, it } from 'vitest';

import {
  classifyEvidenceFailure,
  describeError,
  describeEvidence,
  describeRunStatus,
  EVIDENCE_FAILURE_MESSAGES,
  formatBytes,
  humanizeKey,
  isTerminalStatus,
  shouldPollRun,
  summarizeOutputs,
  summarizeProgress,
} from './run-view-model';

/**
 * A `RunDetailView` with sensible Phase 1 defaults, so each test only spells
 * out the fields it cares about.
 */
function runDetail(overrides: Partial<RunDetailView> = {}): RunDetailView {
  return {
    id: 'run_1',
    status: 'queued',
    businessOutcome: 'none',
    agentVersionId: 'agentver_1',
    queuedAt: '2026-09-05T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    agentVersion: { id: 'agentver_1', name: 'Find Service Request', version: '0.1.0' },
    trigger: { type: 'watchtower_manual', actor: { type: 'development_user', id: 'dev' } },
    inputs: { requestNumber: 'SR-1001' },
    outputs: null,
    error: null,
    steps: [],
    events: [],
    artifacts: [],
    ...overrides,
  };
}

function artifact(overrides: Partial<ArtifactView> = {}): ArtifactView {
  return {
    id: 'artifact_1',
    kind: 'browser_screenshot',
    contentType: 'image/png',
    sizeBytes: 100,
    sha256: 'a'.repeat(64),
    createdAt: '2026-09-05T00:00:00.000Z',
    runStepId: null,
    roles: ['screenshot_after_action'],
    url: '/v1/runs/run_1/artifacts/artifact_1',
    ...overrides,
  };
}

describe('isTerminalStatus', () => {
  it('is not terminal for queued and running', () => {
    expect(isTerminalStatus('queued')).toBe(false);
    expect(isTerminalStatus('running')).toBe(false);
  });

  it('is terminal for succeeded, failed, and cancelled', () => {
    expect(isTerminalStatus('succeeded')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('cancelled')).toBe(true);
  });
});

describe('shouldPollRun', () => {
  it('is false for null', () => {
    expect(shouldPollRun(null)).toBe(false);
  });

  it('continues polling for queued and running', () => {
    expect(shouldPollRun({ status: 'queued' })).toBe(true);
    expect(shouldPollRun({ status: 'running' })).toBe(true);
  });

  it('stops polling for every terminal status', () => {
    expect(shouldPollRun({ status: 'succeeded' })).toBe(false);
    expect(shouldPollRun({ status: 'failed' })).toBe(false);
    expect(shouldPollRun({ status: 'cancelled' })).toBe(false);
  });
});

describe('describeRunStatus', () => {
  it('describes queued as an in-progress, non-terminal state', () => {
    const description = describeRunStatus({ status: 'queued', businessOutcome: 'none' });

    expect(description.label).toBe('Queued');
    expect(description.tone).toBe('progress');
    expect(description.isTerminal).toBe(false);
  });

  it('describes running as an in-progress, non-terminal state', () => {
    const description = describeRunStatus({ status: 'running', businessOutcome: 'none' });

    expect(description.label).toBe('Running');
    expect(description.tone).toBe('progress');
    expect(description.isTerminal).toBe(false);
  });

  it('describes succeeded + request_found as a success', () => {
    const description = describeRunStatus({
      status: 'succeeded',
      businessOutcome: 'request_found',
    });

    expect(description.label).toBe('Succeeded — request found');
    expect(description.tone).toBe('success');
    expect(description.isTerminal).toBe(true);
  });

  it('describes succeeded + request_not_found as an attention state, never a failure', () => {
    const description = describeRunStatus({
      status: 'succeeded',
      businessOutcome: 'request_not_found',
    });

    expect(description.tone).toBe('attention');
    expect(description.tone).not.toBe('failure');
    expect(description.isTerminal).toBe(true);
    expect(description.detail).toContain('business outcome');
    expect(description.detail).toContain('not a failure');
  });

  it('describes succeeded + none as a plain success', () => {
    const description = describeRunStatus({ status: 'succeeded', businessOutcome: 'none' });

    expect(description.label).toBe('Succeeded');
    expect(description.tone).toBe('success');
  });

  it('describes failed as a failure', () => {
    const description = describeRunStatus({ status: 'failed', businessOutcome: 'none' });

    expect(description.tone).toBe('failure');
    expect(description.isTerminal).toBe(true);
  });

  it('describes cancelled as neutral', () => {
    const description = describeRunStatus({ status: 'cancelled', businessOutcome: 'none' });

    expect(description.tone).toBe('neutral');
    expect(description.isTerminal).toBe(true);
  });
});

describe('humanizeKey', () => {
  it('splits camelCase into words and capitalizes only the first', () => {
    expect(humanizeKey('assignedTeam')).toBe('Assigned team');
    expect(humanizeKey('requestNumber')).toBe('Request number');
  });

  it('capitalizes a single lowercase word', () => {
    expect(humanizeKey('status')).toBe('Status');
  });
});

describe('summarizeOutputs', () => {
  it('returns an empty array for null', () => {
    expect(summarizeOutputs(null)).toEqual([]);
  });

  it('preserves each key, humanizes the label, and keeps the value verbatim', () => {
    const rows = summarizeOutputs({
      requestStatus: 'In Progress',
      assignedTeam: 'Infrastructure Operations',
    });

    expect(rows).toEqual([
      { key: 'requestStatus', label: 'Request status', value: 'In Progress' },
      { key: 'assignedTeam', label: 'Assigned team', value: 'Infrastructure Operations' },
    ]);
  });
});

describe('describeError', () => {
  it('returns null for null', () => {
    expect(describeError(null)).toBeNull();
  });

  it('maps code and message, defaulting details to an empty array when absent', () => {
    const error: OrbitError = { code: 'LOCATOR_NOT_FOUND', message: 'Locator not found.' };

    expect(describeError(error)).toEqual({
      code: 'LOCATOR_NOT_FOUND',
      message: 'Locator not found.',
      details: [],
    });
  });

  it('passes details through when present', () => {
    const error: OrbitError = {
      code: 'INPUT_ERROR',
      message: 'Invalid input.',
      details: [{ field: 'requestNumber', message: 'must not be blank' }],
    };

    expect(describeError(error)).toEqual({
      code: 'INPUT_ERROR',
      message: 'Invalid input.',
      details: [{ field: 'requestNumber', message: 'must not be blank' }],
    });
  });
});

describe('describeEvidence', () => {
  it('offers a screenshot as an inline preview', () => {
    const [item] = describeEvidence([artifact({ kind: 'browser_screenshot' })]);

    expect(item!.action).toBe('preview');
    expect(item!.label).toBe('Screenshot');
  });

  it('never offers an HTML snapshot as an inline preview', () => {
    const [item] = describeEvidence([artifact({ kind: 'dom_snapshot', contentType: 'text/html' })]);

    expect(item!.action).toBe('download');
    expect(item!.label).toBe('HTML snapshot');
  });

  it('offers a trace as a download', () => {
    const [item] = describeEvidence([
      artifact({ kind: 'browser_trace', contentType: 'application/zip' }),
    ]);

    expect(item!.action).toBe('download');
    expect(item!.label).toBe('Playwright trace');
  });

  it('passes the url through unchanged and formats the digest', () => {
    const [item] = describeEvidence([
      artifact({ url: '/v1/runs/run_1/artifacts/artifact_1', sha256: 'ab'.repeat(32) }),
    ]);

    expect(item!.url).toBe('/v1/runs/run_1/artifacts/artifact_1');
    expect(item!.digest).toBe(`${'ab'.repeat(32).slice(0, 12)}…`);
  });

  it('never carries a storageKey', () => {
    const [item] = describeEvidence([artifact()]);

    expect(item).not.toHaveProperty('storageKey');
  });
});

describe('formatBytes', () => {
  it('renders sub-kilobyte sizes in bytes', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('renders kilobyte-range sizes with one decimal', () => {
    expect(formatBytes(2048)).toBe('2.0 KB');
  });

  it('renders megabyte-range sizes with one decimal', () => {
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
  });
});

describe('classifyEvidenceFailure', () => {
  it('classifies a 404 as missing regardless of code', () => {
    expect(classifyEvidenceFailure(404)).toBe('missing');
    expect(classifyEvidenceFailure(404, 'ARTIFACT_STORAGE_ERROR')).toBe('missing');
  });

  it('classifies an artifact storage error at 500 as an integrity failure', () => {
    expect(classifyEvidenceFailure(500, 'ARTIFACT_STORAGE_ERROR')).toBe('integrity');
  });

  it('classifies anything else as unavailable', () => {
    expect(classifyEvidenceFailure(500)).toBe('unavailable');
    expect(classifyEvidenceFailure(503)).toBe('unavailable');
  });
});

describe('EVIDENCE_FAILURE_MESSAGES', () => {
  it('has a non-empty message for each evidence failure', () => {
    expect(EVIDENCE_FAILURE_MESSAGES.missing.length).toBeGreaterThan(0);
    expect(EVIDENCE_FAILURE_MESSAGES.integrity.length).toBeGreaterThan(0);
    expect(EVIDENCE_FAILURE_MESSAGES.unavailable.length).toBeGreaterThan(0);
  });

  it('mentions the digest mismatch in the integrity message', () => {
    expect(EVIDENCE_FAILURE_MESSAGES.integrity).toContain('digest');
  });
});

describe('summarizeProgress', () => {
  it('counts only succeeded steps as completed, and all steps as total', () => {
    const run = runDetail({
      steps: [
        {
          id: 'step_1',
          agentStepId: 'navigate',
          stepType: 'browser.navigate',
          sequence: 0,
          attempt: 1,
          status: 'succeeded',
          startedAt: null,
          finishedAt: null,
          output: null,
          error: null,
        },
        {
          id: 'step_2',
          agentStepId: 'fill',
          stepType: 'browser.fill',
          sequence: 1,
          attempt: 1,
          status: 'running',
          startedAt: null,
          finishedAt: null,
          output: null,
          error: null,
        },
      ],
    });

    expect(summarizeProgress(run)).toEqual({
      completedSteps: 1,
      totalSteps: 2,
      failedStep: null,
    });
  });

  it('reports the agentStepId of the first failed step', () => {
    const run = runDetail({
      steps: [
        {
          id: 'step_1',
          agentStepId: 'navigate',
          stepType: 'browser.navigate',
          sequence: 0,
          attempt: 1,
          status: 'succeeded',
          startedAt: null,
          finishedAt: null,
          output: null,
          error: null,
        },
        {
          id: 'step_2',
          agentStepId: 'search',
          stepType: 'browser.click',
          sequence: 1,
          attempt: 1,
          status: 'failed',
          startedAt: null,
          finishedAt: null,
          output: null,
          error: { code: 'LOCATOR_NOT_FOUND', message: 'Locator not found.' },
        },
      ],
    });

    expect(summarizeProgress(run).failedStep).toBe('search');
  });

  it('is null when no step failed', () => {
    expect(summarizeProgress(runDetail({ steps: [] })).failedStep).toBeNull();
  });
});
