import type {
  CapturedAction,
  CapturedNavigation,
  RecordingSession,
  SequenceEntry,
} from '@orbit/execution-recorder';

import type { RecordingSessionFactory } from '../recording/session-registry';

/**
 * A recording session that opens no browser.
 *
 * The registry's own behaviour — ids, polling, finishing, timing out, closing —
 * is worth testing without launching Chromium for each case, and a fake is the
 * only way to script an exact captured sequence. Behind `src/testing/` so
 * production code has no import path to it, matching the fake model provider.
 */
export interface FakeRecordingSession extends RecordingSession {
  /** Adds to what the session reports, as if a person had just done it. */
  readonly push: (entry: SequenceEntry) => void;
  readonly closed: () => boolean;
}

export function createFakeRecordingSession(startUrl: string): FakeRecordingSession {
  const entries: SequenceEntry[] = [];
  let closed = false;
  let url = startUrl;

  return {
    push(entry) {
      entries.push(entry);
      if (entry.type === 'navigate') {
        url = entry.url;
      }
    },
    closed: () => closed,
    isClosed: () => closed,
    page: () => {
      throw new Error('The fake recording session has no page.');
    },
    setMode: () => Promise.resolve(),
    navigate: (next) => {
      url = next;
      return Promise.resolve();
    },
    currentUrl: () => url,
    captures: () =>
      entries.filter(
        (entry): entry is CapturedAction & { order: number } => entry.type !== 'navigate',
      ),
    sequence: () => entries,
    failures: () => [],
    clearCaptures: () => {
      entries.length = 0;
    },
    close: () => {
      closed = true;
      return Promise.resolve();
    },
  };
}

export interface FakeRecordingSessionFactory extends RecordingSessionFactory {
  readonly opened: readonly FakeRecordingSession[];
}

export function createFakeRecordingSessionFactory(
  options: {
    readonly onOpen?: (session: FakeRecordingSession) => void;
    readonly failWith?: string;
  } = {},
): FakeRecordingSessionFactory {
  const opened: FakeRecordingSession[] = [];

  return {
    get opened() {
      return opened;
    },
    open(startUrl) {
      if (options.failWith !== undefined) {
        return Promise.reject(new Error(options.failWith));
      }

      const session = createFakeRecordingSession(startUrl);
      opened.push(session);
      options.onOpen?.(session);
      return Promise.resolve(session);
    },
  };
}

/** A navigation, as the page would report it. */
export function navigation(url: string, order: number): SequenceEntry {
  const entry: CapturedNavigation = {
    id: `nav-${order}`,
    type: 'navigate',
    url,
    capturedAt: new Date('2026-09-06T12:00:00.000Z'),
  };

  return { ...entry, order };
}

/** A click or fill, as the recorder would derive it. */
export function elementCapture(input: {
  readonly type: 'click' | 'fill';
  readonly order: number;
  readonly testId: string;
  readonly name: string;
  readonly typedValue?: string;
  readonly sensitive?: boolean;
}): SequenceEntry {
  const entry: CapturedAction = {
    id: `capture-${input.order}`,
    type: input.type,
    typedValue: input.typedValue,
    sensitive: input.sensitive === true,
    selectors: [
      { strategy: 'test_id', value: input.testId },
      { strategy: 'role_and_name', value: 'button', name: input.name },
    ],
    fingerprint: {
      role: input.type === 'fill' ? 'textbox' : 'button',
      accessibleName: input.name,
      text: input.type === 'fill' ? '' : input.name,
      boundingBox: { x: 0, y: 0, width: 80, height: 32 },
    },
    considered: [],
    url: 'http://localhost:3001/requests',
    capturedAt: new Date('2026-09-06T12:00:00.000Z'),
  };

  return { ...entry, order: input.order };
}
