import { useCallback, useEffect, useState } from 'react';

import type { AgentVersionView, ModelUsageView, SopDraftView } from '@orbit/api/views';

import { AgentsPage } from './AgentsPage';
import {
  ApiRequestError,
  archiveAgent,
  createSopDraft,
  getModelUsage,
  listAgentVersions,
  restoreAgent,
  startRecording,
} from './api-client';
import { APP_INFO } from './app-info';
import { describeSopDraftFailure, type SopDraftFailure } from './sop-draft-view-model';
import { DocumentsPage } from './DocumentsPage';
import { HomePage } from './HomePage';
import { RecordingSessionPage } from './RecordingSessionPage';
import { Nav } from './Nav';
import { searchForView, viewFromSearch, type View } from './navigation';
import { RunPage } from './RunPage';
import { RunsPage } from './RunsPage';
import { SopReviewPage } from './SopReviewPage';
import { useRun } from './useRun';

/**
 * Watchtower.
 *
 * Four places, not one: Home (what Orbit is, the two ways in, and what is going
 * on), Studio (everything drafted or recorded), Agents (what can be run), and
 * Runs (what has been). Everything rendered comes from the API's view of
 * durable server state.
 *
 * This component owns drafting and recording state rather than `HomePage`,
 * because both outlive the home view: a draft survives navigating away and back,
 * and starting a recording navigates to the recording page while the request is
 * still in flight.
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
  const [modelUsage, setModelUsage] = useState<ModelUsageView | null>(null);
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

  /**
   * Spend, refreshed after every Generate as well as on load.
   *
   * A failure here is swallowed on purpose: this is a courtesy display, and the
   * server refuses an over-budget Generate whether or not it rendered. Showing
   * an error about a spend readout would be louder than the thing it reports.
   */
  const refreshModelUsage = useCallback(async () => {
    try {
      setModelUsage(await getModelUsage());
    } catch {
      setModelUsage(null);
    }
  }, []);

  useEffect(() => {
    void refreshModelUsage();
  }, [refreshModelUsage]);

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
      // After the failure path as well as the success path: a refused call
      // still spent tokens if it got as far as the model, and a call the budget
      // stopped did not — the ledger knows which, and this is how the display
      // finds out.
      void refreshModelUsage();
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
            ← Back to Studio
          </button>
          <SopReviewPage
            bindingSessionId={view.bindingSessionId ?? null}
            onBindingSessionChange={(sessionId) => {
              // Reflected in the URL so a reload reattaches to the open
              // browser rather than orphaning the window it opened.
              navigate(
                sessionId === null
                  ? { kind: 'review', documentId: view.documentId }
                  : { kind: 'review', documentId: view.documentId, bindingSessionId: sessionId },
              );
            }}
            walkthroughSessionId={view.walkthroughSessionId ?? null}
            onWalkthroughSessionChange={(sessionId) => {
              navigate(
                sessionId === null
                  ? { kind: 'review', documentId: view.documentId }
                  : {
                      kind: 'review',
                      documentId: view.documentId,
                      walkthroughSessionId: sessionId,
                    },
              );
            }}
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
        <HomePage
          draft={draft}
          draftFailure={draftFailure}
          isGeneratingDraft={isGeneratingDraft}
          isStartingRecording={isStartingRecording}
          modelUsage={modelUsage}
          onGenerate={(sourceText) => void generateDraft(sourceText)}
          onNavigate={navigate}
          onStartRecording={(title, startUrl) => void beginRecording(title, startUrl)}
          recordingError={recordingError}
        />
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
