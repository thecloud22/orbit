/**
 * The decisions `check-teardown.mjs` makes, separated from the things it does.
 *
 * Every function here is pure: it takes observations — which ports answered,
 * which command lines `ps` printed — and returns a verdict, touching no socket
 * and no process table. That is what lets `pnpm test` prove the property this
 * script exists for, which is not "nothing is running" but something narrower:
 *
 *   **A port a developer's own `pnpm dev` legitimately holds is not a leak.**
 *
 * The check used to treat all six ports alike, so it failed for everyone with a
 * dev stack up — and a check that fails when nothing is wrong is a check people
 * learn to ignore, which is worse than not having one.
 */

/**
 * Ports reserved for the end-to-end stack, per `apps/api/src/testing/stack-ports.ts`.
 *
 * No app in this repository may listen on either, so an occupant is a leaked
 * test run and nothing else. These are the only ports that can fail this check.
 */
export const TEST_OWNED_PORTS = [
  { port: 3010, what: 'Watchtower (end-to-end)' },
  { port: 3102, what: 'API (end-to-end)' },
];

/**
 * Ports the development stack binds.
 *
 * Reported, never failed on. `pnpm dev` owns these, the suites deliberately
 * *adopt* rather than fight them — `browser-global-setup.ts` reuses a portal
 * already listening on 3001 — and the teardown of an adopted process is, by
 * design, to leave it running.
 */
export const DEVELOPER_PORTS = [
  { port: 3000, what: 'Watchtower (development)' },
  { port: 3001, what: 'demo portal' },
  { port: 3002, what: 'API (development)' },
  { port: 3020, what: 'library portal' },
];

/**
 * Command-line fragments that identify a process a *test* started.
 *
 * The distinction is the same one `managed-process.ts` draws between a process
 * a run started and one it adopted, applied to evidence available after the
 * fact: a suite starts its servers through `startManagedProcess` as
 * `pnpm --filter @orbit/<app> <script>`, and that exact wrapper command line is
 * what these match. A developer's `pnpm dev` does not produce them — it runs
 * `pnpm -r --parallel dev`, whose children appear as bare `vite`/`tsx` command
 * lines — so a running dev stack cannot trip these patterns.
 */
export const LEAKED_PROCESS_PATTERNS = [
  { pattern: '--filter @orbit/demo-portal', what: 'demo portal started by a suite' },
  { pattern: '--filter @orbit/library-portal', what: 'library portal started by a suite' },
  { pattern: '--filter @orbit/web', what: 'Watchtower started by a suite' },
  { pattern: '--filter @orbit/api', what: 'API started by a suite' },
  { pattern: 'src/cli/run-agent.ts', what: 'browser-worker CLI' },
  { pattern: 'ms-playwright', what: 'Playwright browser' },
];

/**
 * Turns observations into failures and notes.
 *
 * `openPorts` is the set of port numbers that answered; `commandLines` is a
 * list of `{ pid, command }` from the process table, already stripped of this
 * script's own tree by the caller.
 */
export function evaluateTeardown({ openPorts, commandLines }) {
  const open = new Set(openPorts);
  const failures = [];
  const notes = [];

  for (const { port, what } of TEST_OWNED_PORTS) {
    if (open.has(port)) {
      failures.push(
        `port ${port} is still held (${what}). This port is reserved for the end-to-end stack, ` +
          `so an occupant is a leaked test run.`,
      );
    }
  }

  for (const { port, what } of DEVELOPER_PORTS) {
    if (open.has(port)) {
      notes.push(`port ${port} is in use (${what}) — a development stack, not a leak.`);
    }
  }

  for (const { pid, command } of commandLines) {
    for (const { pattern, what } of LEAKED_PROCESS_PATTERNS) {
      if (command.includes(pattern)) {
        failures.push(`${what} still running (pid ${pid}): ${command.slice(0, 120)}`);
      }
    }
  }

  return { failures, notes };
}

/** Parses one `ps -Ao pid=,command=` line. Returns null for anything else. */
export function parseProcessLine(line) {
  const match = /^\s*(\d+)\s+(.*)$/.exec(line);

  if (match === null) {
    return null;
  }

  return { pid: Number(match[1]), command: match[2] };
}
