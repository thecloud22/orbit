import { useEffect, useState } from 'react';

import type { AgentVersionView, SopDraftView } from '@orbit/api/views';

import { ApiRequestError, createSopDraft, listAgentVersions, startRecording } from './api-client';
import { APP_INFO } from './app-info';
import { EvidenceList } from './EvidenceList';
import { RunStatusPanel } from './RunStatusPanel';
import { RunTimeline } from './RunTimeline';
import { describeSopDraftFailure, type SopDraftFailure } from './sop-draft-view-model';
import { SopDraftForm } from './SopDraftForm';
import { SopDraftPanel } from './SopDraftPanel';
import { DocumentsPage } from './DocumentsPage';
import { RecordingSessionPage } from './RecordingSessionPage';
import { RecordWorkflowForm } from './RecordWorkflowForm';
import { Nav } from './Nav';
import { searchForView, viewFromSearch, type View } from './navigation';
import { SopReviewPage } from './SopReviewPage';
import { StartRunForm } from './StartRunForm';
import { useRun } from './useRun';

/**
 * Watchtower.
 *
 * One agent, one input, one run at a time: start it, watch persisted state
 * arrive, and open the evidence it recorded. Everything rendered comes from the
 * API's view of durable server state.
 */
export function App() {
  const [agentVersions, setAgentVersions] = useState<readonly AgentVersionView[]>([]);
  const [catalogError, setCatalogError] = useState<ApiRequestError | null>(null);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(true);
  const [draft, setDraft] = useState<SopDraftView | null>(null);
  const [draftFailure, setDraftFailure] = useState<SopDraftFailure | null>(null);
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [isStartingRecording, setIsStartingRecording] = useState(false);
  const [recordingError, setRecordingError] = useState<ApiRequestError | null>(null);
  const [view, setView] = useState<View>(() => viewFromSearch(window.location.search));
  /** Set when arriving from a publish, so the new agent is findable on a busy page. */
  const highlightedAgentVersionId = view.kind === 'home' ? view.agentVersionId : undefined;
  const run = useRun();

  /**
   * The browser's own history, honoured.
   *
   * Before this, `pushState` was called and nothing listened for `popstate`, so
   * the back button changed the URL and left the page showing the previous
   * view — a URL and a screen quietly disagreeing. Deriving the view from the
   * URL on every history event is what keeps them the same thing.
   */
  useEffect(() => {
    function syncFromUrl() {
      setView(viewFromSearch(window.location.search));
    }

    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, []);

  function navigate(next: View) {
    const url = new URL(window.location.href);
    url.search = searchForView(next);

    // The run parameter is view-scoped: carrying it onto Documents would leave
    // a stale run id in a URL someone might share.
    window.history.pushState({}, '', url);
    setView(next);
  }

  async function generateDraft(sourceText: string) {
    setIsGeneratingDraft(true);
    setDraftFailure(null);

    try {
      setDraft(await createSopDraft(sourceText));
    } catch (caught) {
      // A draft that failed is replaced by the failure, not shown beside it:
      // leaving the previous draft on screen next to an error invites reading
      // the old one as the result of the new request.
      setDraft(null);
      setDraftFailure(
        describeSopDraftFailure(
          caught instanceof ApiRequestError
            ? caught
            : new ApiRequestError({ status: 0, message: 'The API could not be reached.' }),
        ),
      );
    } finally {
      setIsGeneratingDraft(false);
    }
  }

  /**
   * A run can be reopened by id: `?runId=run_...`. That is the whole of run
   * navigation in Phase 1 — there is deliberately no run list, no history, and
   * no filtering.
   */
  const { adopt } = run;
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('runId');

    if (requested !== null) {
      void adopt(requested);
    }
  }, [adopt]);

  /**
   * Re-fetched every time Home becomes the active view, not only once at
   * mount.
   *
   * `App` never unmounts as the URL changes — navigation is client-side state,
   * not a page load — so a fetch keyed to mount alone runs exactly once for
   * the whole session. A workflow published while looking at its review page
   * would then never appear: the catalog snapshot taken before anything was
   * published is what Home would show forever, however many times you
   * navigated back to it. `view.kind` is the dependency rather than `view`
   * itself so leaving Home and returning re-triggers this without re-running
   * on every documentId change inside the review page.
   */
  useEffect(() => {
    if (view.kind !== 'home') {
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const versions = await listAgentVersions();
        if (!cancelled) {
          // Every published agent, not just the first. Before 2.6 there was
          // only ever the seeded one, so `versions[0]` was indistinguishable
          // from "the agent"; publishing makes that a real omission.
          setAgentVersions(versions);
          setCatalogError(null);
        }
      } catch (caught) {
        if (!cancelled) {
          setCatalogError(
            caught instanceof ApiRequestError
              ? caught
              : new ApiRequestError({ status: 0, message: 'The API could not be reached.' }),
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingCatalog(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [view.kind]);

  async function beginRecording(title: string, startUrl: string) {
    setIsStartingRecording(true);
    setRecordingError(null);

    try {
      const session = await startRecording(title, startUrl);
      navigate({ kind: 'recording', sessionId: session.sessionId });
    } catch (caught) {
      setRecordingError(
        caught instanceof ApiRequestError
          ? caught
          : new ApiRequestError({ status: 0, message: 'The API could not be reached.' }),
      );
    } finally {
      setIsStartingRecording(false);
    }
  }

  if (view.kind !== 'home') {
    return (
      <Shell current={view} onNavigate={navigate}>
        {view.kind === 'recording' ? (
          <RecordingSessionPage
            onCancelled={() => navigate({ kind: 'home' })}
            onFinished={navigate}
            sessionId={view.sessionId}
          />
        ) : view.kind === 'review' ? (
          <>
            <button
              className="self-start text-sm text-slate-600 underline"
              data-testid="close-review"
              onClick={() => navigate({ kind: 'documents' })}
              type="button"
            >
              ← Back to workflows
            </button>
            <SopReviewPage
              onOpenAgent={(agentVersionId) => {
                navigate({ kind: 'home', agentVersionId });
              }}
              documentId={view.documentId}
            />
          </>
        ) : (
          <DocumentsPage onOpen={navigate} />
        )}
      </Shell>
    );
  }

  return (
    <Shell current={view} onNavigate={navigate}>
      {/*
        Creating a workflow comes first, not running one — the two paths a new
        team has, given equal top billing, above the returning-user action of
        starting something that already exists. The two are peers: one is
        faster when you can describe the task, the other is exact when you
        would rather just do it once.
      */}
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-slate-900">Create a workflow</h2>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded border border-slate-200 p-4" data-testid="guided-path-card">
            <h3 className="text-sm font-semibold text-slate-900">Guided path via AI</h3>
            <p className="mt-1 text-xs text-slate-600">
              Describe the procedure in your own words. Orbit reads it and proposes a structured,
              reviewable workflow.
            </p>
            <div className="mt-3">
              <SopDraftForm
                isGenerating={isGeneratingDraft}
                onGenerate={(sourceText) => void generateDraft(sourceText)}
              />
            </div>
          </section>

          <section className="rounded border border-slate-200 p-4" data-testid="record-own-card">
            <h3 className="text-sm font-semibold text-slate-900">Record your own</h3>
            <p className="mt-1 text-xs text-slate-600">
              Do the task once in a real browser. Orbit writes down every step and the exact element
              it acted on.
            </p>
            <div className="mt-3">
              <RecordWorkflowForm
                isStarting={isStartingRecording}
                onStart={(title, startUrl) => void beginRecording(title, startUrl)}
              />
            </div>
          </section>
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
              className="rounded border border-slate-300 px-3 py-1.5 text-sm"
              data-testid="open-draft-review"
              onClick={() => navigate({ kind: 'review', documentId: draft.documentId })}
              type="button"
            >
              Review and edit this draft
            </button>
          </div>
        )}

        <SopDraftPanel draft={draft} failure={draftFailure} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-slate-900">Your agents</h2>

        {agentVersions.length === 0 ? (
          <section className="rounded border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900" data-testid="agent-name">
              {isLoadingCatalog
                ? 'Loading agents…'
                : 'Nothing published yet — publish a reviewed workflow to run it here.'}
            </h3>
          </section>
        ) : (
          agentVersions.map((version) => (
            <section
              className={
                highlightedAgentVersionId === version.id
                  ? 'rounded border-2 border-slate-900 p-4'
                  : 'rounded border border-slate-200 p-4'
              }
              data-testid={`agent-card-${version.id}`}
              key={version.id}
            >
              <h3 className="text-sm font-semibold text-slate-900" data-testid="agent-name">
                {`${version.name} ${version.version}`}
              </h3>

              <div className="mt-3">
                <StartRunForm
                  agentVersion={version}
                  isStarting={run.isStarting}
                  onStart={(inputs) => {
                    void run.start(version.id, inputs);
                  }}
                />
              </div>
            </section>
          ))
        )}

        {catalogError !== null && (
          <ApiErrorNotice
            error={catalogError}
            testId="catalog-error"
            title="The agent list could not be loaded"
          />
        )}

        {run.error !== null && (
          <ApiErrorNotice
            error={run.error}
            testId="run-request-error"
            title="The request was not accepted"
          />
        )}

        {run.run !== null && (
          <>
            <RunStatusPanel
              isRefreshing={run.isRefreshing}
              onRefresh={() => void run.refresh()}
              pollingStopped={run.pollingStopped}
              run={run.run}
            />
            <RunTimeline run={run.run} />
            <EvidenceList run={run.run} />
          </>
        )}

        {run.run === null && run.isStarting && (
          <p className="text-sm text-slate-600" data-testid="run-starting">
            Starting the run…
          </p>
        )}
      </section>
    </Shell>
  );
}

/**
 * The frame every view sits in.
 *
 * Title and navigation live here rather than being repeated per view, so a
 * reader never loses their place by opening a document — which is what happened
 * before, when the review page replaced the whole page including any way back.
 */
function Shell({
  current,
  onNavigate,
  children,
}: {
  readonly current: View;
  readonly onNavigate: (view: View) => void;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200">
        <div className="mx-auto max-w-4xl px-8 pt-8 pb-3">
          <h1 className="text-2xl font-semibold text-slate-900">{APP_INFO.title}</h1>
          <p className="mt-1 text-sm text-slate-500">{APP_INFO.description}</p>
        </div>
        <Nav current={current} onNavigate={onNavigate} />
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-6 p-8">{children}</main>
    </div>
  );
}

function ApiErrorNotice({
  error,
  title,
  testId,
}: {
  readonly error: ApiRequestError;
  readonly title: string;
  readonly testId: string;
}) {
  return (
    <section className="rounded border border-rose-300 bg-rose-50 p-4" data-testid={testId}>
      <h2 className="text-sm font-semibold text-rose-900">{title}</h2>
      <p className="mt-1 text-sm text-rose-900" data-testid={`${testId}-message`}>
        {error.message}
      </p>
      {error.details.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-rose-900">
          {error.details.map((detail) => (
            <li key={`${detail.field}:${detail.message}`}>
              <span className="font-medium">{detail.field}</span>: {detail.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
