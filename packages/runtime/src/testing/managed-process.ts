import { spawn, type ChildProcess } from 'node:child_process';
import { connect } from 'node:net';

/**
 * Local services started by a test, and stopped deterministically.
 *
 * Several suites need a real server — the demo portal, the API, Watchtower — and
 * each of them got this slightly wrong in a different way before this module
 * existed. The rules are now in one place:
 *
 *  - a child is started **detached**, so the whole process group can be
 *    signalled; killing the `pnpm` wrapper alone leaves the server it spawned
 *    holding its port;
 *  - `stop()` **waits** for the process to actually exit rather than firing a
 *    signal and moving on, because a following suite that truncates the test
 *    database must not start while a live process is still writing to it;
 *  - a process that ignores `SIGTERM` is escalated to `SIGKILL` rather than
 *    hanging the run;
 *  - `stop()` is idempotent and safe on a process that has already exited.
 *
 * Test-only. It lives beside the other testing helpers rather than in a package
 * of its own, and nothing in production imports it.
 */

/** How long a process gets to exit on SIGTERM before it is killed outright. */
export const SHUTDOWN_GRACE_MS = 15_000;

export interface ManagedProcess {
  readonly name: string;
  readonly pid: number | undefined;
  /** Stops the process group and resolves once it has exited. Idempotent. */
  stop(): Promise<void>;
}

export interface StartManagedProcessOptions {
  /** Used only in messages, so a failure names which service it was. */
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  /** Overrides how long SIGTERM is given before SIGKILL. Tests use a short one. */
  readonly shutdownGraceMs?: number;
}

export function startManagedProcess(options: StartManagedProcessOptions): ManagedProcess {
  const child: ChildProcess = spawn(options.command, [...options.args], {
    cwd: options.cwd,
    stdio: 'ignore',
    detached: true,
    env: options.env === undefined ? process.env : { ...process.env, ...options.env },
  });

  let exited = false;
  const hasExited = new Promise<void>((resolve) => {
    child.once('exit', () => {
      exited = true;
      resolve();
    });
    child.once('error', () => {
      exited = true;
      resolve();
    });
  });

  return {
    name: options.name,
    get pid() {
      return child.pid;
    },

    async stop() {
      const { pid } = child;

      if (pid === undefined || exited) {
        return;
      }

      signalGroup(pid, 'SIGTERM');

      // The grace timer is cleared the moment the process exits. Racing against
      // an uncleared setTimeout leaves it pending for the whole grace period,
      // which keeps the Node event loop alive long after teardown "finished" —
      // and is exactly what made the test runner report that it could not shut
      // down cleanly.
      const grace = cancellableDelay(options.shutdownGraceMs ?? SHUTDOWN_GRACE_MS);

      try {
        const timedOut = await Promise.race([hasExited.then(() => false), grace.expired]);

        if (timedOut) {
          signalGroup(pid, 'SIGKILL');
          await hasExited;
        }
      } finally {
        grace.cancel();
      }
    },
  };
}

/** A stand-in for a service this process did not start and must not stop. */
export function adoptedProcess(name: string): ManagedProcess {
  return {
    name,
    pid: undefined,
    async stop() {
      // Deliberately nothing: only a service this run started is stopped again.
    },
  };
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    // Negative pid targets the whole group, which is why children are detached.
    process.kill(-pid, signal);
  } catch {
    // Already gone, or never became a group leader; the direct signal below is
    // the fallback and its failure is equally harmless.
    try {
      process.kill(pid, signal);
    } catch {
      // Nothing left to signal.
    }
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 performs the permission and existence check without delivering.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export interface WaitForHttpOptions {
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
  readonly probeTimeoutMs?: number;
}

export async function isHttpReady(url: string, probeTimeoutMs = 1_500): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(probeTimeoutMs) });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Polls a URL until it answers.
 *
 * Readiness is always a poll against the service's own endpoint, never a fixed
 * sleep: a sleep is either too short on a slow machine or wasted time on a fast
 * one, and it cannot tell the difference between "starting" and "failed".
 */
export async function waitForHttpReady(
  url: string,
  description: string,
  options: WaitForHttpOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const intervalMs = options.intervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (await isHttpReady(url, options.probeTimeoutMs)) {
      return;
    }

    if (Date.now() > deadline) {
      throw new Error(`${description} did not answer at ${url} within ${timeoutMs}ms.`);
    }

    await delay(intervalMs);
  }
}

/**
 * Loopback addresses a local server may bind.
 *
 * Both are checked because they are genuinely different sockets: Vite resolves
 * `localhost` to `::1` first on macOS, so a probe of `127.0.0.1` alone reports a
 * still-listening dev server as gone — which would make the teardown wait below
 * a no-op exactly where it matters most.
 */
export const LOOPBACK_HOSTS = ['127.0.0.1', '::1'] as const;

function connectsTo(port: number, host: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    let settled = false;

    const finish = (open: boolean) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(open);
      }
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/** True while anything is accepting connections on the port, on either stack. */
export async function isPortOpen(
  port: number,
  hosts: readonly string[] = LOOPBACK_HOSTS,
  timeoutMs = 500,
): Promise<boolean> {
  const results = await Promise.all(hosts.map((host) => connectsTo(port, host, timeoutMs)));
  return results.some(Boolean);
}

/**
 * Waits until nothing is listening on a port any more.
 *
 * Stopping a managed process waits for the process it started — but that is a
 * `pnpm` wrapper, and the server it spawned is a grandchild in the same process
 * group. The group gets the signal together, yet the grandchild can outlive the
 * wrapper by a moment, so "the wrapper exited" is not the same claim as "the
 * port is free". Teardown is only finished when the service has actually stopped
 * answering, and that is what this checks.
 */
export async function waitForPortReleased(
  port: number,
  description: string,
  options: { readonly timeoutMs?: number; readonly intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const intervalMs = options.intervalMs ?? 100;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (!(await isPortOpen(port))) {
      return;
    }

    if (Date.now() > deadline) {
      throw new Error(`${description} still holds port ${port} after ${timeoutMs}ms.`);
    }

    await delay(intervalMs);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** A timer that can be cleared, so losing a race does not leave it pending. */
function cancellableDelay(milliseconds: number): {
  readonly expired: Promise<true>;
  readonly cancel: () => void;
} {
  let handle: ReturnType<typeof setTimeout> | undefined;

  const expired = new Promise<true>((resolve) => {
    handle = setTimeout(() => resolve(true), milliseconds);
  });

  return {
    expired,
    cancel: () => {
      if (handle !== undefined) {
        clearTimeout(handle);
      }
    },
  };
}
