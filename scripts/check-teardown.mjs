#!/usr/bin/env node
/**
 * Proves a test run left nothing behind.
 *
 * Orbit's browser suites start real servers and a real browser. A suite that
 * passes but leaks a process is not a suite that can be run twice, so this is
 * checked mechanically rather than by eye.
 *
 * What counts as "left behind" is narrower than "something is listening", and
 * getting that wrong was a real cost: the check used to fail whenever a
 * developer had `pnpm dev` up, which is the normal state of a working machine.
 * The suites deliberately *adopt* a dev server rather than fight it — that
 * adoption is why `pnpm test:runtime` finishes in ~100s reusing a portal
 * instead of starting a second one — so a dev port being held is the system
 * working, not a defect. Only ports 3010 and 3102, reserved for the end-to-end
 * stack and bound by no app in this repository, can fail this check.
 *
 * The decisions live in `teardown-checks.mjs` and are unit-tested by
 * `pnpm test`; this file only observes and prints.
 *
 * Run it after the suites, never during one.
 */
import { execFileSync } from 'node:child_process';
import { connect } from 'node:net';

import {
  DEVELOPER_PORTS,
  evaluateTeardown,
  parseProcessLine,
  TEST_OWNED_PORTS,
} from './teardown-checks.mjs';

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

const allPorts = [...TEST_OWNED_PORTS, ...DEVELOPER_PORTS];
const openPorts = [];

for (const { port } of allPorts) {
  if (await isPortOpen(port)) {
    openPorts.push(port);
  }
}

// This script's own `ps` invocation and the shell that launched it both contain
// the patterns, so the check ignores its own process tree.
const ownPids = new Set([process.pid, process.ppid]);

const commandLines = runningProcesses()
  .map(parseProcessLine)
  .filter(
    (entry) =>
      entry !== null && !ownPids.has(entry.pid) && !entry.command.includes('check-teardown'),
  );

const { failures, notes } = evaluateTeardown({ openPorts, commandLines });

for (const note of notes) {
  process.stdout.write(`Note: ${note}\n`);
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
  `Teardown check passed: the reserved test ports ${TEST_OWNED_PORTS.map(
    (entry) => entry.port,
  ).join(', ')} are free and no Orbit service started by a suite survives.\n`,
);
