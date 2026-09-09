import type { RunId, RunStatus } from '@orbit/contracts';

/**
 * Detecting a run left behind by a killed API process (detection only).
 *
 * Phase 1 executes in-process with no durable queue (ADR-011): dispatching a
 * run holds nothing durable outside the run row itself, so a `queued` or
 * `running` run is either work this process is about to pick up or is
 * actively executing right now -- there is no third possibility, and nothing
 * else can move a run out of either state. That makes a non-terminal run
 * queued *before this process started* an unambiguous orphan rather than a
 * guess: whatever process was executing it is gone, and this one never
 * touched it.
 *
 * Deliberately detection-only. Automatically failing an orphan risks marking
 * a run that is, in fact, still genuinely executing under some other process
 * this deployment does not know about (unlikely in Phase 1's single-process
 * model, but not something this module should assume it can rule out) --
 * and a run's terminal status is a fact other things read (evidence,
 * business outcome), which should never be written from a guess. Surfacing
 * the fact is unambiguous; resolving it is an operator decision.
 */
export interface OrphanedRun {
  readonly runId: RunId;
  readonly status: RunStatus;
  readonly queuedAt: Date;
}

/** The minimum a run record needs to be checked. */
export interface NonTerminalRun {
  readonly id: RunId;
  readonly status: RunStatus;
  readonly queuedAt: Date;
}

/**
 * Every run in `runs` queued before `processStartedAt` -- i.e. by a process
 * that is not this one. `runs` is expected to already be filtered to
 * non-terminal statuses (`RunRepository.listNonTerminal`); this function does
 * not re-check status, only recency.
 */
export function detectOrphanedRuns(
  runs: readonly NonTerminalRun[],
  processStartedAt: Date,
): readonly OrphanedRun[] {
  return runs
    .filter((run) => run.queuedAt < processStartedAt)
    .map((run) => ({ runId: run.id, status: run.status, queuedAt: run.queuedAt }));
}
