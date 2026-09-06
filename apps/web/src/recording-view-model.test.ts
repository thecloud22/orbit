import type { RecordingSessionView } from '@orbit/api/views';
import { describe, expect, it } from 'vitest';

import { ApiRequestError } from './api-client';
import {
  canFinish,
  describeRecordingFailure,
  LOCAL_BROWSER_NOTICE,
  recordedRows,
} from './recording-view-model';

function session(actions: RecordingSessionView['actions']): RecordingSessionView {
  return {
    sessionId: 'rec_abc',
    title: 'Find a service request',
    startUrl: 'http://localhost:3001/requests',
    currentUrl: 'http://localhost:3001/requests',
    startedAt: '2026-09-06T12:00:00.000Z',
    actions,
  };
}

describe('recordedRows', () => {
  it('reads in the order things happened, whatever order they arrive in', () => {
    const rows = recordedRows(
      session([
        { order: 3, kind: 'click', description: 'Clicked "Search"', sensitive: false },
        { order: 1, kind: 'navigate', description: 'Opened the portal', sensitive: false },
        { order: 2, kind: 'fill', description: 'Filled "Request number"', sensitive: false },
      ]),
    );

    expect(rows.map((row) => row.label)).toEqual([
      'Opened the portal',
      'Filled "Request number"',
      'Clicked "Search"',
    ]);
    expect(rows.map((row) => row.order)).toEqual([1, 2, 3]);
  });

  it('marks a field whose value was deliberately not read', () => {
    const rows = recordedRows(
      session([{ order: 1, kind: 'fill', description: 'Filled "Password"', sensitive: true }]),
    );

    expect(rows[0]?.sensitive).toBe(true);
  });

  it('shows nothing before the first poll returns', () => {
    expect(recordedRows(null)).toEqual([]);
  });
});

describe('canFinish', () => {
  it('is false until something has been recorded', () => {
    expect(canFinish(null)).toBe(false);
    expect(canFinish(session([]))).toBe(false);
  });

  it('is true once anything has', () => {
    expect(
      canFinish(session([{ order: 1, kind: 'navigate', description: 'Opened', sensitive: false }])),
    ).toBe(true);
  });
});

describe('describeRecordingFailure', () => {
  it('says the recording survived when it could not be compiled', () => {
    // The most important sentence on the page when this happens: a recording
    // cannot be repeated from memory.
    const failure = describeRecordingFailure(
      new ApiRequestError({
        status: 422,
        message: 'That recording could not become a workflow. The session is still open.',
        details: [{ field: 'graph', message: '[SCHEMA_ERROR] something' }],
      }),
    );

    expect(failure.kind).toBe('not_compilable');
    expect(failure.sessionSurvived).toBe(true);
    expect(failure.issues).toEqual(['[SCHEMA_ERROR] something']);
  });

  it('says plainly when the session is gone, so nobody waits for it', () => {
    const failure = describeRecordingFailure(
      new ApiRequestError({ status: 404, message: 'That recording session is not open.' }),
    );

    expect(failure.kind).toBe('gone');
    expect(failure.sessionSurvived).toBe(false);
  });

  it('separates "nothing yet" from a real failure', () => {
    const failure = describeRecordingFailure(
      new ApiRequestError({
        status: 400,
        message: 'Nothing was recorded, so there is no workflow to save.',
      }),
    );

    expect(failure.kind).toBe('nothing_recorded');
    expect(failure.sessionSurvived).toBe(true);
  });

  it('treats anything else as a request problem that did not lose the recording', () => {
    const failure = describeRecordingFailure(
      new ApiRequestError({ status: 500, message: 'Something broke.' }),
    );

    expect(failure.kind).toBe('request_failed');
    expect(failure.sessionSurvived).toBe(true);
  });
});

describe('the local-browser notice', () => {
  it('says where the browser opens, rather than leaving it to be discovered', () => {
    // Someone on a laptop pointed at a remote API would otherwise wait for a
    // window that never appears.
    expect(LOCAL_BROWSER_NOTICE).toContain('machine running Orbit');
    expect(LOCAL_BROWSER_NOTICE).toContain('your own machine');
  });
});
