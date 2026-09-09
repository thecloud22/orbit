import type { AgentVersionView } from '@orbit/api/views';

import { ApiErrorNotice } from '../shared/ApiErrorNotice';
import type { ApiRequestError } from '../api-client';
import { StartRunForm } from '../runs/StartRunForm';

/**
 * Every published agent, and the form that triggers each one.
 *
 * Moved out of Home in favour of its own tab once publishing made more than
 * one agent possible: a list of things you can *run* belongs apart from the
 * two ways of *creating* a new one, not stacked underneath them.
 */
export function AgentsPage(props: {
  readonly agentVersions: readonly AgentVersionView[];
  readonly catalogError: ApiRequestError | null;
  readonly isLoadingCatalog: boolean;
  readonly highlightedAgentVersionId: string | undefined;
  readonly isStarting: boolean;
  /**
   * A run that failed before it could be created — a bad input, most likely.
   * There is no run to send a person to in that case, so the error is shown
   * right here, on the page the button was clicked from, rather than on the
   * run page a failed start never reaches.
   */
  readonly startError: ApiRequestError | null;
  readonly onStart: (agentVersionId: string, inputs: Readonly<Record<string, string>>) => void;
  /** The version whose agent is mid-archive, so its own button can say so. */
  readonly archivingAgentVersionId: string | null;
  readonly archiveError: ApiRequestError | null;
  readonly onArchive: (agentVersionId: string) => void;
  /** The most recently archived agent, kept only long enough to offer undo. */
  readonly justArchived: { readonly agentVersionId: string; readonly name: string } | null;
  readonly onUndoArchive: (agentVersionId: string) => void;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-semibold text-slate-900">Agents</h2>

      {props.justArchived !== null && (
        <div
          className="flex items-center justify-between rounded border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-900"
          data-testid="agent-archived-banner"
        >
          <span>{`"${props.justArchived.name}" was archived.`}</span>
          <button
            className="font-medium underline"
            data-testid="undo-archive-button"
            onClick={() => props.onUndoArchive(props.justArchived!.agentVersionId)}
            type="button"
          >
            Undo
          </button>
        </div>
      )}

      {props.agentVersions.length === 0 ? (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900" data-testid="agent-name">
            {props.isLoadingCatalog
              ? 'Loading agents…'
              : 'Nothing published yet — publish a reviewed workflow to run it here.'}
          </h3>
        </section>
      ) : (
        props.agentVersions.map((version) => (
          <section
            className={
              props.highlightedAgentVersionId === version.id
                ? 'rounded-lg border-2 border-indigo-500 bg-white p-5 shadow-md'
                : 'rounded-lg border border-slate-200 bg-white p-5 shadow-sm'
            }
            data-testid={`agent-card-${version.id}`}
            key={version.id}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900" data-testid="agent-name">
                  {`${version.name} ${version.version}`}
                </h3>
                {version.description !== null && (
                  <p className="mt-1 text-xs text-slate-500">{version.description}</p>
                )}
              </div>

              <button
                className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:border-rose-300 hover:text-rose-700 disabled:text-slate-300"
                data-testid={`archive-agent-${version.id}`}
                disabled={props.archivingAgentVersionId === version.id}
                onClick={() => {
                  if (
                    window.confirm(
                      `Archive "${version.name}"? It stays runnable in its own history, but disappears from this list and can no longer start new runs.`,
                    )
                  ) {
                    props.onArchive(version.id);
                  }
                }}
                type="button"
              >
                {props.archivingAgentVersionId === version.id ? 'Archiving…' : 'Archive'}
              </button>
            </div>

            <div className="mt-3">
              <StartRunForm
                agentVersion={version}
                isStarting={props.isStarting}
                onStart={(inputs) => props.onStart(version.id, inputs)}
              />
            </div>
          </section>
        ))
      )}

      {props.catalogError !== null && (
        <ApiErrorNotice
          error={props.catalogError}
          testId="catalog-error"
          title="The agent list could not be loaded"
        />
      )}

      {props.archiveError !== null && (
        <ApiErrorNotice
          error={props.archiveError}
          testId="archive-error"
          title="The agent could not be archived"
        />
      )}

      {props.startError !== null && (
        <ApiErrorNotice
          error={props.startError}
          testId="run-request-error"
          title="The request was not accepted"
        />
      )}
    </section>
  );
}
