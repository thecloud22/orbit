import { useEffect, useState } from 'react';

import type { AgentVersionView, SopDraftView } from '@orbit/api/views';

import { ApiRequestError, createSopDraft, listAgentVersions } from './api-client';
import { APP_INFO } from './app-info';
import { EvidenceList } from './EvidenceList';
import { RunStatusPanel } from './RunStatusPanel';
import { RunTimeline } from './RunTimeline';
import { describeSopDraftFailure, type SopDraftFailure } from './sop-draft-view-model';
import { SopDraftForm } from './SopDraftForm';
import { SopDraftPanel } from './SopDraftPanel';
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
  const [agentVersion, setAgentVersion] = useState<AgentVersionView | null>(null);
  const [catalogError, setCatalogError] = useState<ApiRequestError | null>(null);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(true);
  const [draft, setDraft] = useState<SopDraftView | null>(null);
  const [draftFailure, setDraftFailure] = useState<SopDraftFailure | null>(null);
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [reviewingDocumentId, setReviewingDocumentId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('documentId'),
  );
  const run = useRun();

  /**
   * Opening a draft for review is a URL, matching how a run is reopened by id.
   * Watchtower has no router, and one query parameter is enough for the two
   * things it can show.
   */
  function openReview(documentId: string) {
    const url = new URL(window.location.href);
    url.searchParams.set('documentId', documentId);
    window.history.pushState({}, '', url);
    setReviewingDocumentId(documentId);
  }

  function closeReview() {
    const url = new URL(window.location.href);
    url.searchParams.delete('documentId');
    window.history.pushState({}, '', url);
    setReviewingDocumentId(null);
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

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const versions = await listAgentVersions();
        if (!cancelled) {
          setAgentVersion(versions[0] ?? null);
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
  }, []);

  if (reviewingDocumentId !== null) {
    return (
      <main className="mx-auto flex max-w-4xl flex-col gap-6 p-8">
        <header>
          <h1 className="text-2xl font-semibold text-slate-900">{APP_INFO.title}</h1>
          <button
            className="mt-2 text-sm text-slate-600 underline"
            data-testid="close-review"
            onClick={closeReview}
            type="button"
          >
            ← Back to Watchtower
          </button>
        </header>

        <SopReviewPage documentId={reviewingDocumentId} />
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">{APP_INFO.title}</h1>
        <p className="mt-1 text-sm text-slate-600">{APP_INFO.description}</p>
      </header>

      <section className="rounded border border-slate-200 p-4">
        <h2 className="text-sm font-semibold text-slate-900" data-testid="agent-name">
          {agentVersion === null
            ? isLoadingCatalog
              ? 'Loading agents…'
              : 'No published agent is available.'
            : `${agentVersion.name} ${agentVersion.version}`}
        </h2>

        <div className="mt-3">
          <StartRunForm
            agentVersion={agentVersion}
            isStarting={run.isStarting}
            onStart={(requestNumber) => {
              if (agentVersion !== null) {
                void run.start(agentVersion.id, requestNumber);
              }
            }}
          />
        </div>
      </section>

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

      <section className="rounded border border-slate-200 p-4">
        <h2 className="text-sm font-semibold text-slate-900">
          Draft a workflow from a description
        </h2>
        <p className="mt-1 text-xs text-slate-600">
          Sub-phase 2.2: Orbit reads what you write and proposes a structured draft. Reviewing and
          editing it arrives in the next sub-phase.
        </p>
        <div className="mt-3">
          <SopDraftForm
            isGenerating={isGeneratingDraft}
            onGenerate={(sourceText) => void generateDraft(sourceText)}
          />
        </div>
      </section>

      {draft !== null && (
        <div>
          <button
            className="rounded border border-slate-300 px-3 py-1.5 text-sm"
            data-testid="open-draft-review"
            onClick={() => openReview(draft.documentId)}
            type="button"
          >
            Review and edit this draft
          </button>
        </div>
      )}

      <SopDraftPanel draft={draft} failure={draftFailure} />
    </main>
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
