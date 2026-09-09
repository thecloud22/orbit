import type { RunInputs } from '@orbit/contracts';

import type { DispatchedRun, DispatchRunRequest, RunDispatcher } from './dispatch';

/**
 * Suppresses a duplicate run request arriving within a short window of an
 * identical one, so it returns the run already in flight rather than
 * dispatching a second one.
 *
 * The failure mode this guards against is seconds long by nature: a
 * double-click before a button's `disabled` state paints, a browser retrying
 * a slow POST it never saw a response to, or a resubmitted form. It is not a
 * durable idempotency contract -- a person choosing to rerun the exact same
 * inputs a minute later is a new, legitimate run, and this must not remember
 * that long enough to refuse it.
 *
 * Deliberately in-process and in-memory rather than a persisted dispatch key:
 * Phase 1 has one API process and no queue (ADR-011), and CLAUDE.md rules out
 * Redis or a durable queue for this phase. A single `Map` with a short TTL is
 * the whole mechanism, and it disappears on restart exactly as harmlessly as
 * an in-flight run's evidence would need to be reconciled anyway.
 *
 * Scoped to this HTTP route rather than `RunDispatcher` itself: the interface
 * is also the seam a future queue-backed dispatcher implements (ADR-011's own
 * comment), and de-duplicating HTTP double-submits is a property of this
 * entry point, not of what dispatching a run means in general.
 *
 * The map holds the **pending promise**, not a resolved run id. Two requests
 * arriving close enough together both reach this function before either has
 * awaited the inner dispatcher, so checking-then-setting an already-resolved
 * value would race: the second call would see nothing yet and dispatch a
 * second run regardless. Storing the promise itself, synchronously, before
 * awaiting it closes that window -- a concurrent caller awaits the same
 * dispatch rather than starting its own.
 */
export function withDuplicateDispatchSuppression(
  dispatcher: RunDispatcher,
  options: { readonly windowMs?: number; readonly now?: () => number } = {},
): RunDispatcher {
  const windowMs = options.windowMs ?? 5000;
  const now = options.now ?? Date.now;

  interface Entry {
    readonly promise: Promise<DispatchedRun>;
    readonly expiresAt: number;
  }

  const recent = new Map<string, Entry>();

  function sweep(at: number): void {
    for (const [key, entry] of recent) {
      if (entry.expiresAt <= at) {
        recent.delete(key);
      }
    }
  }

  /** Order-independent, so the same inputs in a different key order still match. */
  function fingerprint(request: DispatchRunRequest): string {
    const sortedInputs = sortedEntries(request.inputs);
    return JSON.stringify([request.agentVersionId, request.trigger.actor, sortedInputs]);
  }

  function sortedEntries(inputs: RunInputs): readonly (readonly [string, string])[] {
    return Object.entries(inputs).sort(([left], [right]) => left.localeCompare(right));
  }

  return {
    dispatch(request: DispatchRunRequest): Promise<DispatchedRun> {
      const at = now();
      const key = fingerprint(request);
      const existing = recent.get(key);

      if (existing !== undefined && existing.expiresAt > at) {
        return existing.promise;
      }

      const promise = dispatcher.dispatch(request);
      recent.set(key, { promise, expiresAt: at + windowMs });
      sweep(at);

      // A dispatch that failed before a run row existed (the one way this can
      // reject) must not keep a rapid retry pinned to that same failure for
      // the rest of the window -- only a genuine duplicate of a run that
      // actually started should be suppressed.
      promise.catch(() => {
        if (recent.get(key)?.promise === promise) {
          recent.delete(key);
        }
      });

      return promise;
    },
  };
}
