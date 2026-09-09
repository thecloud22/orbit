import { describe, expect, it } from 'vitest';

import { detectOrphanedRuns, type NonTerminalRun } from './orphan-runs';

function run(overrides: Partial<NonTerminalRun> = {}): NonTerminalRun {
  return {
    id: 'run_1' as never,
    status: 'running',
    queuedAt: new Date('2026-09-09T00:00:00.000Z'),
    ...overrides,
  };
}

describe('detectOrphanedRuns', () => {
  it('flags a run queued before this process started', () => {
    // The one case this exists for: the API was killed mid-run, and a fresh
    // process has no in-memory dispatch for work it never started.
    const processStartedAt = new Date('2026-09-09T01:00:00.000Z');

    const result = detectOrphanedRuns(
      [run({ id: 'run_orphan' as never, queuedAt: new Date('2026-09-09T00:00:00.000Z') })],
      processStartedAt,
    );

    expect(result).toEqual([
      { runId: 'run_orphan', status: 'running', queuedAt: new Date('2026-09-09T00:00:00.000Z') },
    ]);
  });

  it('does not flag a run this same process dispatched after it started', () => {
    const processStartedAt = new Date('2026-09-09T01:00:00.000Z');

    const result = detectOrphanedRuns(
      [run({ id: 'run_live' as never, queuedAt: new Date('2026-09-09T01:00:01.000Z') })],
      processStartedAt,
    );

    expect(result).toEqual([]);
  });

  it('treats a run queued at the exact boot instant as not orphaned', () => {
    // Boundary case: this process's own boot is the earliest a run it
    // dispatched could be queued, so equal is "this process", not "before it".
    const processStartedAt = new Date('2026-09-09T01:00:00.000Z');

    const result = detectOrphanedRuns([run({ queuedAt: processStartedAt })], processStartedAt);

    expect(result).toEqual([]);
  });

  it('reports every orphan, not just the first', () => {
    const processStartedAt = new Date('2026-09-09T02:00:00.000Z');

    const result = detectOrphanedRuns(
      [
        run({ id: 'run_a' as never, queuedAt: new Date('2026-09-09T00:00:00.000Z') }),
        run({ id: 'run_b' as never, queuedAt: new Date('2026-09-09T01:00:00.000Z') }),
      ],
      processStartedAt,
    );

    expect(result.map((entry) => entry.runId)).toEqual(['run_a', 'run_b']);
  });

  it('is empty for no runs', () => {
    expect(detectOrphanedRuns([], new Date())).toEqual([]);
  });
});
