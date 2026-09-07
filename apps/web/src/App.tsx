import { useCallback, useEffect, useState } from 'react';

import type { AgentVersionView, SopDraftView } from '@orbit/api/views';

import { AgentsPage } from './AgentsPage';
import { ApiErrorNotice } from './ApiErrorNotice';
import {
  ApiRequestError,
  archiveAgent,
  createSopDraft,
  listAgentVersions,
  restoreAgent,
  startRecording,
} from './api-client';
import { APP_INFO } from './app-info';
import { describeSopDraftFailure, type SopDraftFailure } from './sop-draft-view-model';
import { SopDraftForm } from './SopDraftForm';
import { SopDraftPanel } from './SopDraftPanel';
import { DocumentsPage } from './DocumentsPage';
import { RecordingSessionPage } from './RecordingSessionPage';
import { RecordWorkflowForm } from './RecordWorkflowForm';
import { Nav } from './Nav';
import { searchForView, viewFromSearch, type View } from './navigation';
import { RunPage } from './RunPage';
import { RunsPage } from './RunsPage';
import { SopReviewPage } from './SopReviewPage';
import { useRun } from './useRun';

/**
 * Watchtower.
 *
 * Four places, not one: create a workflow, trigger an agent, watch one run,
 * and review what has been drafted or recorded. Everything rendered comes
 * from the API's view of durable server state.
 */
export function App() {
  const [agentVersions, setAgentVersions] = useState<readonly AgentVersionView[]>([]);
  const [catalogError, setCatalogError] = useState<ApiRequestError | null>(null);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(true);
  const [archivingAgentVersionId, setArchivingAgentVersionId] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<ApiRequestError | null>(null);
  const [justArchived, setJustArchived] = useState<{
    readonly agentVersionId: string;
    readonly name: string;
  } | null>(null);
  const [draft, setDraft] = useState<SopDraftView | null>(null);
  const [draftFailure, setDraftFailure] = useState<SopDraftFailure | null>(null);
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [isStartingRecording, setIsStartingRecording] = useState(false);
  const [recordingError, setRecordingError] = useState<ApiRequestError | null>(null);
  const [view, setView] = useState<View>(() => viewFromSearch(window.location.search));
  /** Set when arriving from a publish, so the new agent is findable on a busy page. */
  const highlightedAgentVersionId = view.kind === 'agents' ? view.agentVersionId : undefined;
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

  const navigate = useCallback((next: View) => {
    const url = new URL(window.location.href);
    url.search = searchForView(next);

    window.history.pushState({}, '', url);
    setView(next);
  }, []);

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
   * A run is reopened by id whenever its own page becomes current — following
   * a link, a bookmark, or a row clicked in the Runs list — and not only once
   * at mount. `run.runId` is excluded from the dependency list on purpose: it
   * changes as a side effect of the adoption this effect performs, and
   * including it would adopt the same run again every time it finishes
   * loading.
   */
  const { adopt, runId: loadedRunId } = run;
  useEffect(() => {
    if (view.kind === 'run' && view.runId !== loadedRunId) {
      void adopt(view.runId);
    }
  }, [view, adopt]);

  /**
   * Re-fetched every time Agents becomes the active view, not only once at
   * mount.
   *
   * `App` never unmounts as the URL changes — navigation is client-side state,
   * not a page load — so a fetch keyed to mount alone runs exactly once for
   * the whole session. A workflow published while looking at its review page
   * would then never appear on Agents: the catalog snapshot taken before
   * anything was published is what it would show forever, however many times
   * you navigated back. `view.kind` is the dependency rather than `view`
   * itself so leaving Agents and returning re-triggers this without
   * re-running on every unrelated view change.
   */
  useEffect(() => {
    if (view.kind !== 'agents') {
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const versions = await listAgentVersions();
        if (!cancelled) {
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

  /** Re-reads the catalog after archiving or restoring changes what it shows. */
  async function reloadCatalog() {
    try {
      setAgentVersions(await listAgentVersions());
      setCatalogError(null);
    } catch (caught) {
      setCatalogError(
        caught instanceof ApiRequestError
          ? caught
          : new ApiRequestError({ status: 0, message: 'The API could not be reached.' }),
      );
    }
  }

  async function archiveAgentVersion(agentVersionId: string, name: string) {
    setArchivingAgentVersionId(agentVersionId);
    setArchiveError(null);

    try {
      await archiveAgent(agentVersionId);
      setJustArchived({ agentVersionId, name });
      await reloadCatalog();
    } catch (caught) {
      setArchiveError(
        caught instanceof ApiRequestError
          ? caught
          : new ApiRequestError({ status: 0, message: 'The API could not be reached.' }),
      );
    } finally {
      setArchivingAgentVersionId(null);
    }
  }

  async function undoArchive(agentVersionId: string) {
    setJustArchived(null);

    try {
      await restoreAgent(agentVersionId);
      await reloadCatalog();
    } catch (caught) {
      setArchiveError(
        caught instanceof ApiRequestError
          ? caught
          : new ApiRequestError({ status: 0, message: 'The API could not be reached.' }),
      );
    }
  }

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

  async function startAgent(agentVersionId: string, inputs: Readonly<Record<string, string>>) {
    // Triggering a run leaves the page it was triggered from: what a run
    // produced is inspected on its own page, not appended beneath the button
    // that created it.
    const runId = await run.start(agentVersionId, inputs);

    if (runId !== null) {
      navigate({ kind: 'run', runId });
    }
  }

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
              navigate({ kind: 'agents', agentVersionId });
            }}
            documentId={view.documentId}
          />
        </>
      ) : view.kind === 'documents' ? (
        <DocumentsPage onOpen={navigate} />
      ) : view.kind === 'agents' ? (
        <AgentsPage
          agentVersions={agentVersions}
          archiveError={archiveError}
          archivingAgentVersionId={archivingAgentVersionId}
          catalogError={catalogError}
          highlightedAgentVersionId={highlightedAgentVersionId}
          isLoadingCatalog={isLoadingCatalog}
          isStarting={run.isStarting}
          justArchived={justArchived}
          onArchive={(agentVersionId) => {
            const version = agentVersions.find((candidate) => candidate.id === agentVersionId);
            void archiveAgentVersion(
              agentVersionId,
              version === undefined ? agentVersionId : `${version.name} ${version.version}`,
            );
          }}
          onStart={(agentVersionId, inputs) => void startAgent(agentVersionId, inputs)}
          onUndoArchive={(agentVersionId) => void undoArchive(agentVersionId)}
          startError={run.error}
        />
      ) : view.kind === 'runs' ? (
        <RunsPage onOpen={(runId) => navigate({ kind: 'run', runId })} />
      ) : view.kind === 'run' ? (
        <RunPage
          error={run.error}
          isRefreshing={run.isRefreshing}
          isStarting={run.isStarting}
          onRefresh={() => void run.refresh()}
          pollingStopped={run.pollingStopped}
          run={run.run}
        />
      ) : (
        <>
          {/*
            The two ways to create a workflow, given equal top billing as
            named peers rather than one being a fallback for the other: one is
            faster when you can describe the task, the other is exact when you
            would rather just do it once.
          */}
          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold text-slate-900">Create a workflow</h2>

            <div className="grid gap-4 md:grid-cols-2">
              <section
                className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
                data-testid="guided-path-card"
              >
                <h3 className="text-sm font-semibold text-slate-900">Guided path via AI</h3>
                <p className="mt-1 text-xs text-slate-600">
                  Describe the procedure in your own words. Orbit reads it and proposes a
                  structured, reviewable workflow.
                </p>
                <div className="mt-3">
                  <SopDraftForm
                    isGenerating={isGeneratingDraft}
                    onGenerate={(sourceText) => void generateDraft(sourceText)}
                  />
                </div>
              </section>

              <section
                className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
                data-testid="record-own-card"
              >
                <h3 className="text-sm font-semibold text-slate-900">Record your own</h3>
                <p className="mt-1 text-xs text-slate-600">
                  Do the task once in a real browser. Orbit writes down every step and the exact
                  element it acted on.
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
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
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
        </>
      )}
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
    <div className="min-h-screen bg-slate-50">
      <div className="h-1 bg-gradient-to-r from-indigo-600 via-indigo-500 to-sky-500" />
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="mx-auto max-w-5xl px-8 pt-6 pb-3">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            <span className="text-indigo-600">Orbit</span> Watchtower
          </h1>
          <p className="mt-1 text-sm text-slate-500">{APP_INFO.description}</p>
        </div>
        <Nav current={current} onNavigate={onNavigate} />
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-6 p-8 pb-16">{children}</main>
    </div>
  );
}
