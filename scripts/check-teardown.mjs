#!/usr/bin/env node
/**
 * Proves a test run left nothing behind.
 *
 * Orbit's browser suites start real servers and a real browser. A suite that
 * passes but leaks a process is not a suite that can be run twice, so this is
 * checked mechanically rather than by eye: every port those suites use must be
 * free, and no process matching the services they start may still be running.
 *
 * Run it after the suites, never during one — it would legitimately find the
 * servers a suite is still using.
 */
import { execFileSync } from 'node:child_process';
import { connect } from 'node:net';

/** Ports the development stack and the test stacks bind. */
const PORTS = [
  { port: 3000, what: 'Watchtower (development)' },
  { port: 3001, what: 'demo portal' },
  { port: 3002, what: 'API (development)' },
  { port: 3010, what: 'Watchtower (end-to-end)' },
  { port: 3102, what: 'API (end-to-end)' },
];

/**
 * Command-line fragments that identify a leaked Orbit service. Matched against
 * full command lines, so an unrelated editor or shell is not mistaken for one.
 */
const PROCESS_PATTERNS = [
  { pattern: 'apps/api/src/index.ts', what: 'API process' },
  { pattern: 'src/cli/run-agent.ts', what: 'browser-worker CLI' },
  { pattern: '@orbit/demo-portal', what: 'demo portal dev server' },
  { pattern: '@orbit/web', what: 'Watchtower dev server' },
  { pattern: 'ms-playwright', what: 'Playwright browser' },
];

/**
 * Both loopback stacks are probed: Vite resolves `localhost` to `::1` first on
 * macOS, so checking only `127.0.0.1` reports a live dev server as gone.
 */
const LOOPBACK_HOSTS = ['127.0.0.1', '::1'];

function connectsTo(port, host) {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    let settled = false;
    const finish = (open) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(open);
      }
    };
    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function isPortOpen(port) {
  const results = await Promise.all(LOOPBACK_HOSTS.map((host) => connectsTo(port, host)));
  return results.some(Boolean);
}

function runningProcesses() {
  try {
    return execFileSync('ps', ['-Ao', 'pid=,command='], { encoding: 'utf8' }).split('\n');
  } catch {
    return [];
  }
}

const failures = [];

for (const { port, what } of PORTS) {
  if (await isPortOpen(port)) {
    failures.push(`port ${port} is still held (${what})`);
  }
}

// This script's own `ps` invocation and the shell that launched it both contain
// the patterns, so the check ignores its own process tree.
const ownPids = new Set([process.pid, process.ppid]);

for (const line of runningProcesses()) {
  const match = /^\s*(\d+)\s+(.*)$/.exec(line);
  if (match === null) {
    continue;
  }

  const pid = Number(match[1]);
  const command = match[2];

  if (ownPids.has(pid) || command.includes('check-teardown')) {
    continue;
  }

  for (const { pattern, what } of PROCESS_PATTERNS) {
    if (command.includes(pattern)) {
      failures.push(`${what} still running (pid ${pid}): ${command.slice(0, 120)}`);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write('Teardown check FAILED. Something survived the test run:\n');
  for (const failure of failures) {
    process.stderr.write(`  - ${failure}\n`);
  }
  process.stderr.write(
    '\nStop the leftovers before re-running, and treat this as a teardown defect.\n',
  );
  process.exit(1);
}

process.stdout.write(
  `Teardown check passed: ports ${PORTS.map((entry) => entry.port).join(', ')} are free and no Orbit service process survives.\n`,
);
