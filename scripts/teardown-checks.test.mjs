import { describe, expect, it } from 'vitest';

import {
  DEVELOPER_PORTS,
  evaluateTeardown,
  parseProcessLine,
  TEST_OWNED_PORTS,
} from './teardown-checks.mjs';

const noProcesses = { commandLines: [] };

describe('evaluateTeardown', () => {
  it('passes when nothing is listening and nothing is running', () => {
    expect(evaluateTeardown({ openPorts: [], ...noProcesses })).toEqual({
      failures: [],
      notes: [],
    });
  });

  /**
   * The defect this split exists for. A developer's `pnpm dev` holds all four
   * of these, and the suites are built to reuse them rather than replace them,
   * so a teardown check that failed here failed for doing nothing wrong.
   */
  it('does not fail on a developer stack holding every development port', () => {
    const { failures, notes } = evaluateTeardown({
      openPorts: DEVELOPER_PORTS.map((entry) => entry.port),
      ...noProcesses,
    });

    expect(failures).toEqual([]);
    expect(notes).toHaveLength(DEVELOPER_PORTS.length);
    expect(notes.join('\n')).toContain('not a leak');
  });

  it.each(TEST_OWNED_PORTS)('still fails when reserved port $port is occupied', ({ port }) => {
    const { failures } = evaluateTeardown({ openPorts: [port], ...noProcesses });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(`port ${port}`);
  });

  it('fails on a reserved port even while the whole development stack is up', () => {
    const { failures, notes } = evaluateTeardown({
      openPorts: [...DEVELOPER_PORTS.map((entry) => entry.port), 3102],
      ...noProcesses,
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('port 3102');
    expect(notes).toHaveLength(DEVELOPER_PORTS.length);
  });

  /**
   * `pnpm dev` runs `pnpm -r --parallel dev`, and the servers it starts appear
   * as bare `vite` and `tsx` command lines. A suite's servers do not: they are
   * started as `pnpm --filter @orbit/<app> <script>`, and that wrapper is the
   * evidence the patterns match on.
   */
  it('ignores the process tree a developer stack actually produces', () => {
    const { failures } = evaluateTeardown({
      openPorts: [],
      commandLines: [
        { pid: 1857, command: 'node /Users/dev/.nvm/versions/node/v26.8.1/bin/pnpm dev' },
        {
          pid: 1870,
          command: 'node /Users/dev/.nvm/versions/node/v26.8.1/bin/pnpm -r --parallel dev',
        },
        {
          pid: 1885,
          command: 'node /repo/apps/api/node_modules/.bin/../tsx/dist/cli.mjs watch src/index.ts',
        },
        { pid: 1915, command: 'node /repo/apps/demo-portal/node_modules/.bin/../vite/bin/vite.js' },
        { pid: 1949, command: 'node /repo/apps/web/node_modules/.bin/../vite/bin/vite.js' },
      ],
    });

    expect(failures).toEqual([]);
  });

  it('fails on a server a suite started and did not stop', () => {
    const { failures } = evaluateTeardown({
      openPorts: [],
      commandLines: [
        { pid: 4242, command: 'node /repo/node_modules/.bin/pnpm --filter @orbit/api start:e2e' },
      ],
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('pid 4242');
    expect(failures[0]).toContain('API started by a suite');
  });

  it('fails on a browser a suite left behind', () => {
    const { failures } = evaluateTeardown({
      openPorts: [],
      commandLines: [
        {
          pid: 5150,
          command: '/Users/dev/Library/Caches/ms-playwright/chromium-1234/chrome --headless',
        },
      ],
    });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('Playwright browser');
  });
});

describe('parseProcessLine', () => {
  it('reads the pid and the command from a ps line', () => {
    expect(parseProcessLine('  1885 node /repo/x.js --flag')).toEqual({
      pid: 1885,
      command: 'node /repo/x.js --flag',
    });
  });

  it('returns null for a line that is not a process', () => {
    expect(parseProcessLine('')).toBeNull();
  });
});
