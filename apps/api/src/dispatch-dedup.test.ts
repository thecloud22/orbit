import { describe, expect, it } from 'vitest';

import type { DispatchedRun, DispatchRunRequest, RunDispatcher } from './dispatch';
import { withDuplicateDispatchSuppression } from './dispatch-dedup';

function request(overrides: Partial<DispatchRunRequest> = {}): DispatchRunRequest {
  return {
    agentVersionId: 'agentv_1' as never,
    agentIr: {} as never,
    inputs: { requestNumber: 'SR-1001' },
    trigger: {
      type: 'watchtower_manual',
      actor: { type: 'development_user', id: 'dev-user' },
    },
    ...overrides,
  };
}

/** A dispatcher that hands out a fresh run id per call and counts how many times it ran. */
function countingDispatcher(): RunDispatcher & { calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async dispatch(): Promise<DispatchedRun> {
      calls += 1;
      return { runId: `run_${calls}` as never, completed: Promise.resolve() };
    },
  };
}

/**
 * A dispatcher whose `dispatch` does not resolve until `release()` is
 * called, so a test can hold two concurrent calls open at once -- the actual
 * double-click / double-submit race, where a second identical request
 * arrives while the first dispatch is still in flight rather than after it
 * has resolved.
 */
function stallingDispatcher(): RunDispatcher & { calls: number; release: () => void } {
  let calls = 0;
  let release: () => void = () => undefined;

  return {
    get calls() {
      return calls;
    },
    release: () => release(),
    async dispatch(): Promise<DispatchedRun> {
      calls += 1;
      const runId = `run_${calls}`;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { runId: runId as never, completed: Promise.resolve() };
    },
  };
}

describe('withDuplicateDispatchSuppression', () => {
  it('dispatches the first request normally', async () => {
    const inner = countingDispatcher();
    const dispatcher = withDuplicateDispatchSuppression(inner);

    const result = await dispatcher.dispatch(request());

    expect(result.runId).toBe('run_1');
    expect(inner.calls).toBe(1);
  });

  it('returns the in-flight run for an identical request arriving inside the window, without dispatching again', async () => {
    // The failure mode this exists for: a double-click, or a client retrying a
    // slow POST it never saw a response to.
    let clock = 0;
    const inner = countingDispatcher();
    const dispatcher = withDuplicateDispatchSuppression(inner, { now: () => clock });

    const first = await dispatcher.dispatch(request());
    clock += 500;
    const second = await dispatcher.dispatch(request());

    expect(second.runId).toBe(first.runId);
    expect(inner.calls).toBe(1);
  });

  it('dispatches again once the window has passed', async () => {
    // A person choosing to rerun the exact same inputs later is a new,
    // legitimate run -- this must not remember long enough to refuse it.
    let clock = 0;
    const inner = countingDispatcher();
    const dispatcher = withDuplicateDispatchSuppression(inner, {
      windowMs: 1000,
      now: () => clock,
    });

    await dispatcher.dispatch(request());
    clock += 1001;
    const second = await dispatcher.dispatch(request());

    expect(second.runId).toBe('run_2');
    expect(inner.calls).toBe(2);
  });

  it('dispatches separately for a different agent version', async () => {
    const clock = 0;
    const inner = countingDispatcher();
    const dispatcher = withDuplicateDispatchSuppression(inner, { now: () => clock });

    await dispatcher.dispatch(request({ agentVersionId: 'agentv_1' as never }));
    const second = await dispatcher.dispatch(request({ agentVersionId: 'agentv_2' as never }));

    expect(second.runId).toBe('run_2');
    expect(inner.calls).toBe(2);
  });

  it('dispatches separately for different inputs', async () => {
    const clock = 0;
    const inner = countingDispatcher();
    const dispatcher = withDuplicateDispatchSuppression(inner, { now: () => clock });

    await dispatcher.dispatch(request({ inputs: { requestNumber: 'SR-1001' } }));
    const second = await dispatcher.dispatch(request({ inputs: { requestNumber: 'SR-9999' } }));

    expect(second.runId).toBe('run_2');
    expect(inner.calls).toBe(2);
  });

  it('treats the same inputs in a different key order as the same request', async () => {
    const clock = 0;
    const inner = countingDispatcher();
    const dispatcher = withDuplicateDispatchSuppression(inner, { now: () => clock });

    await dispatcher.dispatch(request({ inputs: { a: '1', b: '2' } }));
    const second = await dispatcher.dispatch(request({ inputs: { b: '2', a: '1' } }));

    expect(second.runId).toBe('run_1');
    expect(inner.calls).toBe(1);
  });

  it('dispatches separately for a different actor', async () => {
    // Two different people starting the same run at the same moment are two
    // real runs, not a duplicate of one.
    const clock = 0;
    const inner = countingDispatcher();
    const dispatcher = withDuplicateDispatchSuppression(inner, { now: () => clock });

    await dispatcher.dispatch(
      request({
        trigger: {
          type: 'watchtower_manual',
          actor: { type: 'development_user', id: 'dev-user-1' },
        },
      }),
    );
    const second = await dispatcher.dispatch(
      request({
        trigger: {
          type: 'watchtower_manual',
          actor: { type: 'development_user', id: 'dev-user-2' },
        },
      }),
    );

    expect(second.runId).toBe('run_2');
    expect(inner.calls).toBe(2);
  });

  it('suppresses a truly concurrent duplicate, not only one that arrives after the first resolved', async () => {
    // The actual double-click / double-submit shape: a second identical
    // request arrives while the first dispatch is still awaiting a database
    // write, before either has returned. A naive check-then-set race would
    // let both through, because the map has nothing in it yet when the
    // second call checks -- confirmed against the real running app before
    // this fix: two truly simultaneous identical requests produced two
    // different run ids.
    const inner = stallingDispatcher();
    const dispatcher = withDuplicateDispatchSuppression(inner);

    const first = dispatcher.dispatch(request());
    const second = dispatcher.dispatch(request());

    inner.release();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(inner.calls).toBe(1);
    expect(secondResult.runId).toBe(firstResult.runId);
  });

  it('does not keep a rapid retry pinned to a dispatch that failed before a run existed', async () => {
    // The one way the inner dispatch rejects, per its own contract: execution
    // failed before a run row was created. A retry a moment later is a fresh
    // attempt, not a duplicate of a failure -- it must not be replayed the
    // stale rejection for the rest of the window.
    let shouldFail = true;
    let calls = 0;
    const inner: RunDispatcher = {
      dispatch: () => {
        calls += 1;
        return shouldFail
          ? Promise.reject(new Error('database unavailable'))
          : Promise.resolve({ runId: `run_${calls}` as never, completed: Promise.resolve() });
      },
    };
    const dispatcher = withDuplicateDispatchSuppression(inner);

    await expect(dispatcher.dispatch(request())).rejects.toThrow('database unavailable');

    shouldFail = false;
    const retried = await dispatcher.dispatch(request());

    expect(retried.runId).toBe('run_2');
    expect(calls).toBe(2);
  });
});
