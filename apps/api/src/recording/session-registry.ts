import { newRequestId } from '@orbit/contracts';
import type { OrbitDatabase } from '@orbit/db';
import {
  openRecordingSession,
  type RecordingSession,
  type SequenceEntry,
} from '@orbit/execution-recorder';
import { createSopRecordingService, type RecordedEntry } from '@orbit/sop-service';
import type { SopGraphIssue } from '@orbit/sop-graph';

/**
 * Recording sessions the API is holding open.
 *
 * This is the one place in the API that drives a browser a person interacts
 * with directly, and the reason ADR-019's ban is narrowed rather than lifted
 * (ADR-020). Everything else in the API stays unable to reach the recorder.
 *
 * The shape mirrors `RunDispatcher` (ADR-011): a caller gets an id as soon as
 * the session exists and polls for what has happened since, so nothing is
 * coupled to the lifetime of an HTTP request. A recording lasts as long as a
 * person takes, which is far longer than any request should.
 *
 * The browser is **headed and local**. It opens on the machine running the API,
 * because a person has to see and click it — which is a real constraint on
 * where Orbit can be deployed, not an implementation detail, and the UI says so.
 */

export type RecordingSessionId = string;

export interface StartRecordingInput {
  readonly title: string;
  readonly startUrl: string;
}

export interface RecordedActionSummary {
  readonly order: number;
  readonly kind: 'navigate' | 'click' | 'fill';
  /** Plain language, for someone watching the list grow. */
  readonly description: string;
  /** True when a password field was touched and its value deliberately not read. */
  readonly sensitive: boolean;
}

export interface RecordingSessionState {
  readonly sessionId: RecordingSessionId;
  readonly title: string;
  readonly startUrl: string;
  readonly currentUrl: string;
  readonly startedAt: string;
  readonly actions: readonly RecordedActionSummary[];
}

export type FinishRecordingResult =
  | {
      readonly ok: true;
      readonly documentId: string;
      readonly stepCount: number;
      readonly bindingCount: number;
    }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'nothing_recorded' }
  | {
      readonly ok: false;
      readonly reason: 'invalid_recording';
      readonly issues: readonly SopGraphIssue[];
    };

export interface RecordingSessionRegistry {
  start(input: StartRecordingInput): Promise<RecordingSessionState>;
  get(sessionId: RecordingSessionId): RecordingSessionState | null;
  finish(sessionId: RecordingSessionId): Promise<FinishRecordingResult>;
  cancel(sessionId: RecordingSessionId): Promise<boolean>;
  /** Closes every open browser. Called when the process shuts down. */
  closeAll(): Promise<void>;
}

/**
 * Opens the browser a session records in.
 *
 * A seam rather than a direct call, for the same reason `BrowserExecutorFactory`
 * is one: the registry's own behaviour — ids, polling, finishing, timing out —
 * is worth testing without launching Chromium for each case.
 */
export interface RecordingSessionFactory {
  open(startUrl: string): Promise<RecordingSession>;
}

export function createPlaywrightRecordingSessionFactory(
  options: {
    readonly headless?: boolean;
  } = {},
): RecordingSessionFactory {
  return {
    open: (startUrl) =>
      openRecordingSession({ startUrl, mode: 'action', headless: options.headless ?? false }),
  };
}

export interface RecordingRegistryOptions {
  readonly database: OrbitDatabase;
  readonly factory: RecordingSessionFactory;
  /**
   * How long an untouched session stays open.
   *
   * A recording holds a real browser process, and a person who walks away
   * should not leave one running until the API restarts.
   */
  readonly idleTimeoutMs?: number;
  /**
   * How often idle sessions are swept.
   *
   * Sweeping only when the next recording starts would mean an abandoned
   * session holds its browser until someone happens to start another one — for
   * the person who walks away and never comes back, which is exactly the case
   * the timeout exists for, that is never. A test sets this small; nothing else
   * passes it.
   */
  readonly sweepIntervalMs?: number;
  readonly now?: () => Date;
}

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 60 * 1000;

interface OpenSession {
  readonly sessionId: RecordingSessionId;
  readonly title: string;
  readonly startUrl: string;
  readonly startedAt: Date;
  readonly session: RecordingSession;
  lastTouchedAt: Date;
}

/** What the page reported, as a sentence someone can read while working. */
function describe(entry: SequenceEntry): RecordedActionSummary | null {
  if (entry.type === 'navigate') {
    return {
      order: entry.order,
      kind: 'navigate',
      description: `Opened ${entry.url}`,
      sensitive: false,
    };
  }

  // A `pick` means someone pointed at a value to read, which belongs to mapping
  // a known step rather than to performing a task.
  if (entry.type === 'pick') {
    return null;
  }

  const named = entry.fingerprint.accessibleName ?? entry.fingerprint.text ?? 'an unnamed element';

  return {
    order: entry.order,
    kind: entry.type,
    description:
      entry.type === 'fill'
        ? `Filled "${named}"${entry.sensitive ? ' — password, value not read' : ''}`
        : `Clicked "${named}"`,
    sensitive: entry.sensitive,
  };
}

/** The recorder's sequence, as the translator needs it. */
function toRecordedEntries(sequence: readonly SequenceEntry[]): readonly RecordedEntry[] {
  const entries: RecordedEntry[] = [];

  for (const entry of sequence) {
    if (entry.type === 'navigate') {
      entries.push({ kind: 'navigate', url: entry.url });
    } else if (entry.type !== 'pick') {
      entries.push({
        kind: entry.type,
        selectors: entry.selectors,
        fingerprint: entry.fingerprint,
        ...(entry.typedValue === undefined ? {} : { typedValue: entry.typedValue }),
        ...(entry.sensitive ? { sensitive: true } : {}),
      });
    }
  }

  return entries;
}

export function createRecordingSessionRegistry(
  options: RecordingRegistryOptions,
): RecordingSessionRegistry {
  const sessions = new Map<RecordingSessionId, OpenSession>();
  const now = options.now ?? (() => new Date());
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const recordings = createSopRecordingService({ database: options.database });

  /** Closes anything nobody has looked at for a while. */
  async function reapIdle(): Promise<void> {
    const deadline = now().getTime() - idleTimeoutMs;

    for (const open of [...sessions.values()]) {
      if (open.lastTouchedAt.getTime() < deadline) {
        sessions.delete(open.sessionId);
        await open.session.close().catch(() => undefined);
      }
    }
  }

  function toState(open: OpenSession): RecordingSessionState {
    return {
      sessionId: open.sessionId,
      title: open.title,
      startUrl: open.startUrl,
      currentUrl: open.session.currentUrl(),
      startedAt: open.startedAt.toISOString(),
      actions: open.session
        .sequence()
        .map(describe)
        .filter((entry): entry is RecordedActionSummary => entry !== null),
    };
  }

  // Unreferenced, so a sweeper never keeps the process alive on its own: the
  // API exits when its server does, not a minute later.
  const sweeper = setInterval(
    () => void reapIdle(),
    options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS,
  );
  sweeper.unref();

  return {
    async start(input) {
      await reapIdle();

      const session = await options.factory.open(input.startUrl);
      const startedAt = now();

      const open: OpenSession = {
        sessionId: `rec_${newRequestId().replace(/^req_/, '')}`,
        title: input.title,
        startUrl: input.startUrl,
        startedAt,
        session,
        lastTouchedAt: startedAt,
      };

      sessions.set(open.sessionId, open);
      return toState(open);
    },

    get(sessionId) {
      const open = sessions.get(sessionId);

      if (open === undefined) {
        return null;
      }

      // Polling counts as activity: someone watching the list is not idle.
      open.lastTouchedAt = now();
      return toState(open);
    },

    async finish(sessionId) {
      const open = sessions.get(sessionId);

      if (open === undefined) {
        return { ok: false, reason: 'not_found' };
      }

      const sequence = open.session.sequence();

      if (sequence.length === 0) {
        return { ok: false, reason: 'nothing_recorded' };
      }

      const result = await recordings.createFromRecording({
        title: open.title,
        startUrl: open.startUrl,
        sequence: toRecordedEntries(sequence),
      });

      if (!result.ok) {
        // The session stays open on a translation failure: the browser still
        // holds the work, and closing it would throw away a recording the
        // person cannot repeat.
        return { ok: false, reason: 'invalid_recording', issues: result.issues };
      }

      sessions.delete(sessionId);
      await open.session.close().catch(() => undefined);

      return {
        ok: true,
        documentId: result.document.id,
        stepCount: result.revision.graph.steps.length,
        bindingCount: result.bindings.length,
      };
    },

    async cancel(sessionId) {
      const open = sessions.get(sessionId);

      if (open === undefined) {
        return false;
      }

      sessions.delete(sessionId);
      await open.session.close().catch(() => undefined);
      return true;
    },

    async closeAll() {
      clearInterval(sweeper);

      const open = [...sessions.values()];
      sessions.clear();
      await Promise.all(open.map((entry) => entry.session.close().catch(() => undefined)));
    },
  };
}
