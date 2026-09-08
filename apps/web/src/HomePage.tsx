import { useEffect, useState } from 'react';

import type { ModelUsageView, SopDraftView } from '@orbit/api/views';

import { ApiErrorNotice } from './ApiErrorNotice';
import { ApiRequestError, listAgentVersions, listRuns, listSopDocuments } from './api-client';
import {
  plural,
  recentRuns,
  summarizeHome,
  unfinishedWorkflows,
  UNFINISHED_WORKFLOW_LIMIT,
  type HomeData,
} from './home-view-model';
import type { View } from './navigation';
import { RecordWorkflowForm } from './RecordWorkflowForm';
import { STATUS_BADGE_CLASSES } from './run-view-model';
import { summarizeModelSpend, type SopDraftFailure } from './sop-draft-view-model';
import { SopDraftForm } from './SopDraftForm';
import { SopDraftPanel } from './SopDraftPanel';

export interface HomePageProps {
  readonly onNavigate: (view: View) => void;

  readonly draft: SopDraftView | null;
  readonly draftFailure: SopDraftFailure | null;
  readonly isGeneratingDraft: boolean;
  readonly onGenerate: (sourceText: string) => void;
  readonly modelUsage: ModelUsageView | null;

  readonly isStartingRecording: boolean;
  readonly recordingError: ApiRequestError | null;
  readonly onStartRecording: (title: string, startUrl: string) => void;
}

/**
 * Watchtower's front door.
 *
 * This was two cards and nothing else — no statement of what Orbit is, and no
 * sign of whether anything had ever been published or run. Someone arriving at
 * it could not tell an empty deployment from a broken one, and the library
 * portal in this same repository was a better-looking product than the thing
 * automating it.
 *
 * Three jobs, in this order: say what Orbit does, offer the two ways in, and
 * show what is actually going on. The state is fetched from three endpoints
 * that already existed; none was added for this page, and every figure links to
 * the tab that owns it rather than becoming a fourth place to work.
 */
export function HomePage({
  onNavigate,
  draft,
  draftFailure,
  isGeneratingDraft,
  onGenerate,
  modelUsage,
  isStartingRecording,
  recordingError,
  onStartRecording,
}: HomePageProps) {
  const { data, failure } = useHomeData();
  const summary = data === null ? null : summarizeHome(data);
  const runs = data === null ? [] : recentRuns(data.runs);
  const unfinished = data === null ? [] : unfinishedWorkflows(data.documents);

  return (
    <div className="flex flex-col gap-8" data-testid="home-page">
      <Hero
        isFresh={summary?.isFresh ?? false}
        onNavigate={onNavigate}
        publishedAgents={summary?.publishedAgents ?? 0}
      />

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            {summary?.isFresh === true ? 'Start with your first workflow' : 'Create a workflow'}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {/*
              Two ways in, named as peers rather than one being the other's
              fallback: one is faster when you can describe the task, the other
              is exact when you would rather just do it once.
            */}
            Two ways in. Neither is the fallback for the other — describing is faster, showing is
            exact.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <article
            className="flex flex-col rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-indigo-300"
            data-testid="guided-path-card"
          >
            <StepBadge>1st way</StepBadge>
            <h3 className="mt-2 text-sm font-semibold text-slate-900">
              Describe it in your own words
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              Write the procedure the way you would explain it to a new colleague. Orbit reads it
              and proposes a structured workflow you can review and correct.
            </p>
            <div className="mt-4">
              <SopDraftForm
                isGenerating={isGeneratingDraft}
                onGenerate={onGenerate}
                spend={summarizeModelSpend(modelUsage)}
              />
            </div>
          </article>

          <article
            className="flex flex-col rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-indigo-300"
            data-testid="record-own-card"
          >
            <StepBadge>2nd way</StepBadge>
            <h3 className="mt-2 text-sm font-semibold text-slate-900">Record yourself doing it</h3>
            <p className="mt-1 text-sm text-slate-600">
              Do the task once in a real browser. Orbit writes down every step and the exact element
              you acted on, so it knows where as well as what.
            </p>
            <div className="mt-4">
              <RecordWorkflowForm isStarting={isStartingRecording} onStart={onStartRecording} />
            </div>
          </article>
        </div>

        {recordingError !== null && (
          <ApiErrorNotice
            error={recordingError}
            testId="recording-start-error"
            title="The recording could not be started"
          />
        )}

        {draft !== null && (
          <div>
            <button
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium transition-colors hover:border-indigo-400 hover:text-indigo-700"
              data-testid="open-draft-review"
              onClick={() => onNavigate({ kind: 'review', documentId: draft.documentId })}
              type="button"
            >
              Review and edit this draft
            </button>
          </div>
        )}

        <SopDraftPanel draft={draft} failure={draftFailure} />
      </section>

      {failure !== null && (
        <ApiErrorNotice
          error={failure}
          testId="home-status-error"
          title="The current state could not be loaded"
        />
      )}

      {/*
        Nothing at all yet: one instruction rather than three empty boxes. Three
        zeroes tell a new reader nothing except that the product looks unused.
      */}
      {summary?.isFresh === true ? (
        <section
          className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center shadow-sm"
          data-testid="home-empty-state"
        >
          <h2 className="text-sm font-semibold text-slate-900">Nothing here yet</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-slate-600">
            No workflows, no agents, no runs. Start above: describe a procedure you repeat often, or
            record yourself doing it once. Either way you will get a workflow you can review,
            publish as an agent, and then trigger from the Agents tab — with evidence kept for every
            run.
          </p>
        </section>
      ) : (
        summary !== null && (
          <section className="flex flex-col gap-4" data-testid="home-at-a-glance">
            <h2 className="text-base font-semibold text-slate-900">Where things stand</h2>

            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard
                href="?view=agents"
                label="Published agents"
                onOpen={() => onNavigate({ kind: 'agents' })}
                testId="home-stat-agents"
                value={summary.publishedAgents}
              />
              <StatCard
                href="?view=runs"
                label="Runs recorded"
                onOpen={() => onNavigate({ kind: 'runs' })}
                testId="home-stat-runs"
                value={summary.totalRuns}
              />
              <StatCard
                href="?view=documents"
                label="Waiting in Studio"
                onOpen={() => onNavigate({ kind: 'documents' })}
                testId="home-stat-studio"
                value={summary.unfinishedWorkflows}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <section
                className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
                data-testid="home-recent-runs"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">Recent runs</h3>
                  <TabLink
                    label="All runs"
                    onOpen={() => onNavigate({ kind: 'runs' })}
                    href="?view=runs"
                  />
                </div>

                {runs.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">
                    Nothing has run yet. Trigger a published agent from the Agents tab.
                  </p>
                ) : (
                  <ul className="mt-3 flex flex-col gap-1">
                    {runs.map((row) => (
                      <li key={row.runId}>
                        <a
                          className="flex items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-slate-50"
                          data-testid="home-run-row"
                          href={row.href}
                          onClick={(event) => {
                            if (isPlainClick(event)) {
                              event.preventDefault();
                              onNavigate({ kind: 'run', runId: row.runId });
                            }
                          }}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-slate-900">
                              {row.agentLabel}
                            </span>
                            <span className="block text-xs text-slate-500">{row.when}</span>
                          </span>
                          <span
                            className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${STATUS_BADGE_CLASSES[row.tone]}`}
                          >
                            {row.statusLabel}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section
                className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
                data-testid="home-unfinished"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">Waiting in Studio</h3>
                  <TabLink
                    label="All workflows"
                    onOpen={() => onNavigate({ kind: 'documents' })}
                    href="?view=documents"
                  />
                </div>

                {unfinished.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">
                    Nothing half-finished. Every workflow has been reviewed.
                  </p>
                ) : (
                  <>
                    <ul className="mt-3 flex flex-col gap-1">
                      {unfinished.slice(0, UNFINISHED_WORKFLOW_LIMIT).map((row) => (
                        <li key={row.documentId}>
                          <a
                            className="flex items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-slate-50"
                            data-testid="home-unfinished-row"
                            href={row.href}
                            onClick={(event) => {
                              if (isPlainClick(event)) {
                                event.preventDefault();
                                onNavigate({ kind: 'review', documentId: row.documentId });
                              }
                            }}
                          >
                            <span className="min-w-0 truncate text-sm font-medium text-slate-900">
                              {row.title}
                            </span>
                            <span className="shrink-0 rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900">
                              {row.statusLabel}
                            </span>
                          </a>
                        </li>
                      ))}
                    </ul>

                    {unfinished.length > UNFINISHED_WORKFLOW_LIMIT && (
                      <p className="mt-2 px-2 text-xs text-slate-500">
                        and {plural(unfinished.length - UNFINISHED_WORKFLOW_LIMIT, 'more')} in
                        Studio.
                      </p>
                    )}
                  </>
                )}
              </section>
            </div>
          </section>
        )
      )}
    </div>
  );
}

/**
 * What Orbit is, stated once, at the top.
 *
 * Specific rather than aspirational: it names the input (a procedure somebody
 * wrote down), the output (an agent that performs it), and the thing that makes
 * it trustworthy (evidence for every run). A reader who has never seen Orbit
 * should be able to say what it does after this paragraph.
 */
function Hero({
  publishedAgents,
  isFresh,
  onNavigate,
}: {
  readonly publishedAgents: number;
  readonly isFresh: boolean;
  readonly onNavigate: (view: View) => void;
}) {
  return (
    <section
      className="overflow-hidden rounded-lg border border-slate-200 bg-gradient-to-br from-indigo-50 via-white to-sky-50 shadow-sm"
      data-testid="home-hero"
    >
      <div className="px-8 py-10 sm:py-12">
        <h1 className="max-w-2xl text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Turn a written procedure into an agent that performs it — and keeps the receipts.
        </h1>

        <p className="mt-4 max-w-2xl text-slate-600">
          Describe a task in plain English, or do it once in a real browser. Orbit turns either one
          into a reviewable workflow, then into a versioned agent that runs the same way every time.
          Every run records its own screenshots, page snapshots and decisions, so what an agent did
          is something you can read back rather than something you have to trust.
        </p>

        {!isFresh && (
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
              data-testid="hero-open-agents"
              onClick={() => onNavigate({ kind: 'agents' })}
              type="button"
            >
              {publishedAgents === 0
                ? 'Go to agents'
                : `Run one of ${plural(publishedAgents, 'agent')}`}
            </button>
            <button
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition-colors hover:border-indigo-400 hover:text-indigo-700"
              data-testid="hero-open-studio"
              onClick={() => onNavigate({ kind: 'documents' })}
              type="button"
            >
              Open Studio
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function StepBadge({ children }: { readonly children: React.ReactNode }) {
  return (
    <span className="w-fit rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
      {children}
    </span>
  );
}

function StatCard({
  label,
  value,
  href,
  onOpen,
  testId,
}: {
  readonly label: string;
  readonly value: number;
  readonly href: string;
  readonly onOpen: () => void;
  readonly testId: string;
}) {
  return (
    <a
      className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-indigo-300"
      data-testid={testId}
      href={href}
      onClick={(event) => {
        if (isPlainClick(event)) {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <p className="text-sm text-slate-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </a>
  );
}

/** A real anchor, so middle-click and open-in-new-tab keep working. */
function TabLink({
  label,
  href,
  onOpen,
}: {
  readonly label: string;
  readonly href: string;
  readonly onOpen: () => void;
}) {
  return (
    <a
      className="text-xs font-medium text-indigo-700 transition-colors hover:text-indigo-900"
      href={href}
      onClick={(event) => {
        if (isPlainClick(event)) {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      {label} →
    </a>
  );
}

/** Modified clicks belong to the browser: a reader asking for a new tab gets one. */
function isPlainClick(event: React.MouseEvent): boolean {
  return !event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0;
}

interface HomeDataState {
  readonly data: HomeData | null;
  readonly failure: ApiRequestError | null;
}

/**
 * The three lists this page reads.
 *
 * Fetched together and failing together: a partial dashboard, where one box is
 * blank because its request failed and the others are populated, reads as "you
 * have no agents" rather than as "this could not be loaded". One error, named
 * as one.
 */
function useHomeData(): HomeDataState {
  const [state, setState] = useState<HomeDataState>({ data: null, failure: null });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [agentVersions, runs, documents] = await Promise.all([
          listAgentVersions(),
          listRuns(),
          listSopDocuments(),
        ]);

        if (!cancelled) {
          setState({ data: { agentVersions, runs, documents }, failure: null });
        }
      } catch (caught) {
        if (!cancelled) {
          setState({
            data: null,
            failure:
              caught instanceof ApiRequestError
                ? caught
                : new ApiRequestError({ status: 0, message: 'The API could not be reached.' }),
          });
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
