import { describe, expect, it } from 'vitest';

import { createServer } from 'node:http';

import {
  adoptedProcess,
  isPortOpen,
  isProcessAlive,
  startManagedProcess,
  waitForHttpReady,
  waitForPortReleased,
} from './managed-process';

/**
 * Regression coverage for the teardown defect this helper was written to fix.
 *
 * A suite used to signal its child servers and move on without waiting, which
 * left a live process writing to the test database while the next suite began
 * truncating it. These tests assert the property that actually matters: when
 * `stop()` resolves, the process is gone.
 */
describe('startManagedProcess', () => {
  function countActiveTimers(): number {
    return process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length;
  }

  /** A child that ignores nothing and simply stays alive until signalled. */
  function longRunningChild() {
    return startManagedProcess({
      name: 'test-child',
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: process.cwd(),
    });
  }

  it('starts a real process and reports its pid', () => {
    const managed = longRunningChild();

    expect(managed.pid).toBeGreaterThan(0);
    expect(isProcessAlive(managed.pid!)).toBe(true);

    return managed.stop();
  });

  it('is gone by the time stop() resolves', async () => {
    const managed = longRunningChild();
    const { pid } = managed;

    await managed.stop();

    expect(isProcessAlive(pid!)).toBe(false);
  });

  /**
   * Regression coverage for a leaked shutdown timer.
   *
   * `stop()` raced the process exit against a 15-second grace timer and did not
   * clear the timer when the process won. The pending timer kept the Node event
   * loop alive for the whole grace period after teardown had supposedly
   * finished, which is what made the test runner report that it could not shut
   * down cleanly.
   */
  it('leaves no pending timer behind after stopping', async () => {
    const before = countActiveTimers();
    const managed = longRunningChild();

    await managed.stop();

    // Sampled immediately: a leaked grace timer would still be pending here and
    // would only disappear once it fired, long after this assertion.
    expect(countActiveTimers()).toBeLessThanOrEqual(before);
  });

  it('can be stopped twice without raising', async () => {
    const managed = longRunningChild();

    await managed.stop();
    await expect(managed.stop()).resolves.toBeUndefined();
  });

  it('resolves promptly for a process that already exited on its own', async () => {
    const managed = startManagedProcess({
      name: 'short-lived',
      command: process.execPath,
      args: ['-e', ''],
      cwd: process.cwd(),
    });

    // Give the child a moment to exit by itself, then confirm stop() is a no-op
    // rather than a wait for a signal nothing will answer.
    await new Promise((resolve) => setTimeout(resolve, 250));

    const startedAt = Date.now();
    await managed.stop();

    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it('escalates to SIGKILL when a process ignores SIGTERM', async () => {
    const managed = startManagedProcess({
      name: 'stubborn',
      command: process.execPath,
      // Ignores SIGTERM entirely, so only SIGKILL can end it.
      args: ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
      cwd: process.cwd(),
      shutdownGraceMs: 500,
    });

    const { pid } = managed;
    await new Promise((resolve) => setTimeout(resolve, 250));

    await managed.stop();

    expect(isProcessAlive(pid!)).toBe(false);
  });
});

describe('adoptedProcess', () => {
  it('never stops a service this run did not start', async () => {
    const adopted = adoptedProcess('already-running-portal');

    expect(adopted.pid).toBeUndefined();
    await expect(adopted.stop()).resolves.toBeUndefined();
  });
});

describe('waitForHttpReady', () => {
  it('gives up with a message naming the service rather than hanging', async () => {
    await expect(
      // Port 1 is never a listening Orbit service.
      waitForHttpReady('http://127.0.0.1:1/health', 'a service that is not there', {
        timeoutMs: 600,
        intervalMs: 100,
        probeTimeoutMs: 100,
      }),
    ).rejects.toThrow('a service that is not there');
  });
});

describe('isPortOpen', () => {
  /**
   * Regression coverage for a probe that checked `127.0.0.1` only.
   *
   * Vite resolves `localhost` to `::1` first on macOS, so a server bound to the
   * IPv6 loopback was reported as gone while it was still listening — which made
   * the teardown wait silently useless for exactly the servers it guards.
   */
  it('sees a server bound only to the IPv6 loopback', async () => {
    const server = createServer((_request, response) => response.end('ok'));
    await new Promise<void>((resolve) => server.listen(0, '::1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    try {
      expect(await isPortOpen(port)).toBe(true);
      // Proving the point: the old single-stack probe would have missed it.
      expect(await isPortOpen(port, ['127.0.0.1'])).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('reports a port nothing is listening on as closed', async () => {
    // Port 1 is never an Orbit service.
    expect(await isPortOpen(1)).toBe(false);
  });
});

describe('waitForPortReleased', () => {
  it('returns once the server has actually stopped listening', async () => {
    const server = createServer((_request, response) => response.end('ok'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    setTimeout(() => server.close(), 150);

    await expect(
      waitForPortReleased(port, 'a test server', { timeoutMs: 5_000 }),
    ).resolves.toBeUndefined();
    expect(await isPortOpen(port)).toBe(false);
  });

  it('fails with a message naming the service when the port never frees', async () => {
    const server = createServer((_request, response) => response.end('ok'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    try {
      await expect(
        waitForPortReleased(port, 'a stubborn service', { timeoutMs: 400, intervalMs: 50 }),
      ).rejects.toThrow('a stubborn service');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
