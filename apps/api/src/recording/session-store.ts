import { newRequestId } from '@orbit/contracts';

/**
 * The plumbing every browser-holding session registry needs.
 *
 * There are two of them now — recording a whole workflow, and binding one step
 * of a drafted one (ADR-027) — and what they share is not their behaviour but
 * their hazard: each holds a real Chromium process that must not outlive the
 * API. Ids, idle reaping, an unreferenced sweeper and `closeAll` are that
 * hazard's handling, and two copies of it would drift in exactly the way that
 * strands a browser.
 *
 * What is deliberately *not* here is anything about what a session means.
 * Starting, finishing, targeting a step and saving a binding differ between the
 * two registries, and folding them together behind one method with a
 * discriminated input is the overload ADR-020 already warned against.
 */

export interface SessionStoreOptions<T> {
  /** `rec` or `bind` — so a session id can never be used against the wrong registry. */
  readonly idPrefix: string;
  readonly idleTimeoutMs: number;
  readonly sweepIntervalMs: number;
  readonly now: () => Date;
  /** Closes whatever the entry holds. Called on reap, remove-and-close, and shutdown. */
  readonly close: (entry: T) => Promise<void>;
}

export interface SessionStore<T> {
  /** Mints an id, stores the entry against it, and returns the id. */
  add(entry: T): string;
  /** Reads an entry, counting the read as activity. */
  get(id: string): T | undefined;
  /** Forgets an entry without closing it. */
  remove(id: string): T | undefined;
  /** Forgets an entry and closes what it holds. */
  removeAndClose(id: string): Promise<T | undefined>;
  /** Closes every open session and stops sweeping. */
  closeAll(): Promise<void>;
  /** Closes anything nobody has touched for longer than the idle timeout. */
  reapIdle(): Promise<void>;
}

export const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const DEFAULT_SWEEP_INTERVAL_MS = 60 * 1000;

interface Held<T> {
  readonly entry: T;
  lastTouchedAt: Date;
}

export function createSessionStore<T>(options: SessionStoreOptions<T>): SessionStore<T> {
  const held = new Map<string, Held<T>>();

  async function closeQuietly(entry: T): Promise<void> {
    await options.close(entry).catch(() => undefined);
  }

  async function reapIdle(): Promise<void> {
    const deadline = options.now().getTime() - options.idleTimeoutMs;

    for (const [id, entry] of [...held.entries()]) {
      if (entry.lastTouchedAt.getTime() < deadline) {
        held.delete(id);
        await closeQuietly(entry.entry);
      }
    }
  }

  // Unreferenced, so a sweeper never keeps the process alive on its own: the
  // API exits when its server does, not a minute later.
  const sweeper = setInterval(() => void reapIdle(), options.sweepIntervalMs);
  sweeper.unref();

  return {
    add(entry) {
      const id = `${options.idPrefix}_${newRequestId().replace(/^req_/, '')}`;
      held.set(id, { entry, lastTouchedAt: options.now() });
      return id;
    },

    get(id) {
      const found = held.get(id);

      if (found === undefined) {
        return undefined;
      }

      // Polling counts as activity: someone watching a session is not idle.
      found.lastTouchedAt = options.now();
      return found.entry;
    },

    remove(id) {
      const found = held.get(id);
      held.delete(id);
      return found?.entry;
    },

    async removeAndClose(id) {
      const found = held.get(id);
      held.delete(id);

      if (found !== undefined) {
        await closeQuietly(found.entry);
      }

      return found?.entry;
    },

    async closeAll() {
      clearInterval(sweeper);

      const open = [...held.values()];
      held.clear();
      await Promise.all(open.map((entry) => closeQuietly(entry.entry)));
    },

    reapIdle,
  };
}
