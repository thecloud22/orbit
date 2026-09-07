import { useCallback, useEffect, useRef, useState } from 'react';

import type { RunDetailView } from '@orbit/api/views';

import { ApiRequestError, getRun, startRun } from './api-client';
import { shouldPollRun } from './run-view-model';

/**
 * Run state for the page.
 *
 * Polling is a client-side timer and nothing more (ADR-011 defers anything
 * durable), and it always stops at the terminal state the *server* reports — the
 * UI never decides a run finished because a request returned.
 */
const POLL_INTERVAL_MS = 1_000;

/** A stop so a server that never reaches a terminal state cannot poll forever. */
const MAX_POLLS = 300;

export interface UseRun {
  readonly runId: string | null;
  readonly run: RunDetailView | null;
  readonly error: ApiRequestError | null;
  readonly isStarting: boolean;
  readonly isRefreshing: boolean;
  readonly pollingStopped: boolean;
  start(agentVersionId: string, inputs: Readonly<Record<string, string>>): Promise<void>;
  /** Watches a run that already exists, so a run can be reopened by id. */
  adopt(runId: string): Promise<void>;
  refresh(): Promise<void>;
}

export function useRun(): UseRun {
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunDetailView | null>(null);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pollingStopped, setPollingStopped] = useState(false);
  const polls = useRef(0);

  const load = useCallback(async (id: string) => {
    setIsRefreshing(true);
    try {
      setRun(await getRun(id));
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError
          ? caught
          : new ApiRequestError({ status: 0, message: 'The API could not be reached.' }),
      );
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const start = useCallback(
    async (agentVersionId: string, inputs: Readonly<Record<string, string>>) => {
      // The in-flight guard. It is a UI guard only: the server accepts a second
      // dispatch and creates a second run, which is a documented Phase 1 limit.
      if (isStarting) {
        return;
      }

      setIsStarting(true);
      setError(null);
      setRun(null);
      setRunId(null);
      setPollingStopped(false);
      polls.current = 0;

      try {
        const created = await startRun(agentVersionId, inputs);
        setRunId(created.runId);
        await load(created.runId);
      } catch (caught) {
        setError(
          caught instanceof ApiRequestError
            ? caught
            : new ApiRequestError({ status: 0, message: 'The API could not be reached.' }),
        );
      } finally {
        setIsStarting(false);
      }
    },
    [isStarting, load],
  );

  const adopt = useCallback(
    async (id: string) => {
      setRunId(id);
      setError(null);
      setPollingStopped(false);
      polls.current = 0;
      await load(id);
    },
    [load],
  );

  const refresh = useCallback(async () => {
    if (runId !== null) {
      await load(runId);
    }
  }, [load, runId]);

  useEffect(() => {
    if (runId === null || !shouldPollRun(run) || pollingStopped) {
      return;
    }

    if (polls.current >= MAX_POLLS) {
      setPollingStopped(true);
      return;
    }

    const timer = setTimeout(() => {
      polls.current += 1;
      void load(runId);
    }, POLL_INTERVAL_MS);

    return () => clearTimeout(timer);
  }, [runId, run, load, pollingStopped]);

  return { runId, run, error, isStarting, isRefreshing, pollingStopped, start, adopt, refresh };
}
