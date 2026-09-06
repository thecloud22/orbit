import type { RecordingSessionView } from '@orbit/api/views';

import type { ApiRequestError } from './api-client';

/**
 * Every decision the recording UI makes, as pure functions.
 *
 * Same arrangement as the other view models here: components render what these
 * return and decide nothing themselves.
 */

/**
 * Stated in the UI rather than discovered.
 *
 * The browser opens on the machine running the API. That is a real constraint
 * on where Orbit can be deployed, and someone clicking Record on a laptop
 * pointed at a remote API would otherwise wait for a window that never appears.
 */
export const LOCAL_BROWSER_NOTICE =
  'A browser window opens on the machine running Orbit. Recording only works when that is your own machine.';

export const RECORDING_EMPTY_MESSAGE =
  'Nothing captured yet. Do the task in the browser window that just opened — every click, typed value and page change appears here.';

export interface RecordedActionRow {
  readonly order: number;
  readonly label: string;
  readonly detail: string;
  readonly sensitive: boolean;
}

/** The captured list, newest last, as a person reads a sequence. */
export function recordedRows(session: RecordingSessionView | null): readonly RecordedActionRow[] {
  if (session === null) {
    return [];
  }

  return [...session.actions]
    .sort((left, right) => left.order - right.order)
    .map((action, index) => ({
      order: index + 1,
      label: action.description,
      detail: action.kind,
      sensitive: action.sensitive,
    }));
}

/** Whether finishing would produce anything. */
export function canFinish(session: RecordingSessionView | null): boolean {
  return session !== null && session.actions.length > 0;
}

export type RecordingFailureKind =
  'nothing_recorded' | 'not_compilable' | 'gone' | 'request_failed';

export interface RecordingFailure {
  readonly kind: RecordingFailureKind;
  readonly title: string;
  readonly message: string;
  /** True when the recording survived, so the reader knows not to start over. */
  readonly sessionSurvived: boolean;
  readonly issues: readonly string[];
}

/**
 * Turns a failure into something a person mid-recording can act on.
 *
 * The distinction that matters most is whether their work survived. A recording
 * cannot be repeated from memory, so telling someone a compile failed while
 * leaving them unsure whether the session is gone is the difference between a
 * fixable problem and a lost afternoon.
 */
export function describeRecordingFailure(error: ApiRequestError): RecordingFailure {
  if (error.status === 422) {
    return {
      kind: 'not_compilable',
      title: 'That recording could not become a workflow',
      message: error.message,
      sessionSurvived: true,
      issues: error.details.map((detail) => detail.message),
    };
  }

  if (error.status === 404) {
    return {
      kind: 'gone',
      title: 'That recording session is no longer open',
      message: error.message,
      sessionSurvived: false,
      issues: [],
    };
  }

  if (error.status === 400 && error.message.toLowerCase().includes('nothing was recorded')) {
    return {
      kind: 'nothing_recorded',
      title: 'Nothing was recorded yet',
      message: error.message,
      sessionSurvived: true,
      issues: [],
    };
  }

  return {
    kind: 'request_failed',
    title: 'The request was not accepted',
    message: error.message,
    sessionSurvived: true,
    issues: error.details.map((detail) => detail.message),
  };
}

/** How long between polls while a recording is open. */
export const RECORDING_POLL_INTERVAL_MS = 1_000;
