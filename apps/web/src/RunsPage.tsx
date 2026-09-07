import { useEffect, useState } from 'react';

import type { RunListItemView } from '@orbit/api/views';

import { ApiErrorNotice } from './ApiErrorNotice';
import { ApiRequestError, listRuns } from './api-client';
import { describeRunStatus, STATUS_BADGE_CLASSES } from './run-view-model';

export interface RunsPageProps {
  readonly onOpen: (runId: string) => void;
}

/**
 * Every run, newest first.
 *
 * Phase 1 deliberately had no run history — a run was reopened by id and
 * nothing else. This is the first place that history is visible rather than
 * something only the database remembers.
 */
export function RunsPage({ onOpen }: RunsPageProps) {
  const [runs, setRuns] = useState<readonly RunListItemView[] | null>(null);
  const [failure, setFailure] = useState<ApiRequestError | null>(null);

  useEffect(() => {
    let cancelled = false;

    listRuns()
      .then((listed) => {
        if (!cancelled) {
          setRuns(listed);
          setFailure(null);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setFailure(
            caught instanceof ApiRequestError
              ? caught
              : new ApiRequestError({ status: 0, message: 'The API could not be reached.' }),
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (failure !== null) {
    return (
      <ApiErrorNotice
        error={failure}
        testId="runs-error"
        title="The run list could not be loaded"
      />
    );
  }

  return (
    <section className="flex flex-col gap-3" data-testid="runs-page">
      <h2 className="text-base font-semibold text-slate-900">Runs</h2>

      {runs === null ? (
        <p className="text-sm text-slate-600">Loading runs…</p>
      ) : runs.length === 0 ? (
        <p className="text-sm text-slate-600">
          No runs yet — start an agent from the Agents tab to see one here.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {runs.map((run) => {
            const status = describeRunStatus(run);

            return (
              <li key={run.id}>
                <button
                  className="flex w-full items-center justify-between gap-3 rounded border border-slate-200 p-3 text-left hover:border-indigo-300"
                  data-testid={`run-row-${run.id}`}
                  onClick={() => onOpen(run.id)}
                  type="button"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {run.agentName} {run.agentVersion}
                    </p>
                    <p className="text-xs text-slate-500">
                      {new Date(run.queuedAt).toLocaleString()}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_BADGE_CLASSES[status.tone]}`}
                  >
                    {status.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
