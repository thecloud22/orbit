import type { AgentVersionView } from '@orbit/api/views';

import { ApiErrorNotice } from './ApiErrorNotice';
import type { ApiRequestError } from './api-client';
import { StartRunForm } from './StartRunForm';

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
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-semibold text-slate-900">Agents</h2>

      {props.agentVersions.length === 0 ? (
        <section className="rounded border border-slate-200 p-4">
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
                ? 'rounded border-2 border-indigo-500 p-4'
                : 'rounded border border-slate-200 p-4'
            }
            data-testid={`agent-card-${version.id}`}
            key={version.id}
          >
            <h3 className="text-sm font-semibold text-slate-900" data-testid="agent-name">
              {`${version.name} ${version.version}`}
            </h3>
            {version.description !== null && (
              <p className="mt-1 text-xs text-slate-500">{version.description}</p>
            )}

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
