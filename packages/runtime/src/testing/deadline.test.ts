import { describe, expect, it, vi } from 'vitest';

import { withDeadline } from './deadline';

describe('withDeadline', () => {
  it('returns the value when the work finishes in time', async () => {
    await expect(withDeadline(Promise.resolve('done'), 1_000, 'the work')).resolves.toBe('done');
  });

  it('passes a rejection through unchanged', async () => {
    const failure = new Error('the work itself failed');

    await expect(withDeadline(Promise.reject(failure), 1_000, 'the work')).rejects.toBe(failure);
  });

  it('names the blocked operation, and says an assertion was not the problem', async () => {
    const never = new Promise<never>(() => undefined);

    await expect(withDeadline(never, 10, 'the drifted run')).rejects.toThrow(
      /the drifted run did not finish within 10ms.*blocked operation, not a failed expectation/s,
    );
  });

  /**
   * An uncleared timer keeps the Node event loop alive past teardown — the
   * failure `managed-process.ts` documents from the other direction — so
   * winning the race is not enough; the loser has to be cleaned up.
   */
  it('leaves no timer pending once the work wins', async () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout');

    await withDeadline(Promise.resolve('done'), 60_000, 'the work');

    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });

  it('does not leave the losing work as an unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    const slowFailure = new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error('too late')), 20);
    });

    await expect(withDeadline(slowFailure, 5, 'the work')).rejects.toThrow('did not finish');

    // Long enough for the losing rejection to arrive and for Node to have
    // reported it, had nothing been listening.
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(unhandled).not.toHaveBeenCalled();
    process.off('unhandledRejection', unhandled);
  });
});
