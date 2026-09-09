import { useEffect, useState } from 'react';

import type { ModelUsageView, SopDocumentSummaryView, SopDraftView } from '@orbit/api/views';

import { ApiRequestError, listSopDocuments } from './api-client';
import { CreateWorkflowSection } from './CreateWorkflowSection';
import { documentRows, EMPTY_DOCUMENTS_MESSAGE, type DocumentTone } from './documents-view-model';
import type { View } from './navigation';
import type { SopDraftFailure } from './sop-draft-view-model';

export interface DocumentsPageProps {
  readonly onOpen: (view: View) => void;

  readonly draft: SopDraftView | null;
  readonly draftFailure: SopDraftFailure | null;
  readonly isGeneratingDraft: boolean;
  readonly onGenerate: (sourceText: string) => void;
  readonly modelUsage: ModelUsageView | null;

  readonly isStartingRecording: boolean;
  readonly recordingError: ApiRequestError | null;
  readonly onStartRecording: (title: string, startUrl: string) => void;
}

const TONE_CLASSES: Readonly<Record<DocumentTone, string>> = {
  neutral: 'bg-slate-100 text-slate-700',
  progress: 'bg-sky-50 text-sky-900',
  success: 'bg-emerald-50 text-emerald-900',
  attention: 'bg-amber-50 text-amber-900',
};

/**
 * Create a workflow, or open one already in progress.
 *
 * The list half has existed since sub-phase 2.3 and was read-only: creating
 * one meant leaving for Home and coming back once it existed, which made this
 * page feel like a dead end for anyone who landed here first. `CreateWorkflowSection`
 * is the same component Home renders — one door, reachable from two places,
 * not two doors that could drift apart.
 */
export function DocumentsPage({
  onOpen,
  draft,
  draftFailure,
  isGeneratingDraft,
  onGenerate,
  modelUsage,
  isStartingRecording,
  recordingError,
  onStartRecording,
}: DocumentsPageProps) {
  const [documents, setDocuments] = useState<readonly SopDocumentSummaryView[] | null>(null);
  const [error, setError] = useState<ApiRequestError | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const listed = await listSopDocuments();
        if (!cancelled) {
          setDocuments(listed);
          setError(null);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(
            caught instanceof ApiRequestError
              ? caught
              : new ApiRequestError({ status: 0, message: 'The API could not be reached.' }),
          );
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  if (error !== null) {
    return (
      <section
        className="rounded border border-rose-300 bg-rose-50 p-4"
        data-testid="documents-error"
      >
        <h2 className="text-sm font-semibold text-rose-900">The workflows could not be loaded</h2>
        <p className="mt-1 text-sm text-rose-900">{error.message}</p>
      </section>
    );
  }

  if (documents === null) {
    return (
      <p className="text-sm text-slate-600" data-testid="documents-loading">
        Loading workflows…
      </p>
    );
  }

  const rows = documentRows(documents);

  return (
    <div className="flex flex-col gap-8" data-testid="documents-page">
      <CreateWorkflowSection
        draft={draft}
        draftFailure={draftFailure}
        isGeneratingDraft={isGeneratingDraft}
        isStartingRecording={isStartingRecording}
        modelUsage={modelUsage}
        onGenerate={onGenerate}
        onNavigate={onOpen}
        onStartRecording={onStartRecording}
        recordingError={recordingError}
      />

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">All workflows</h2>
          <p className="mt-1 text-sm text-slate-600">
            Every workflow you have drafted or recorded, and how far each one has got towards
            becoming an agent you can run.
          </p>
        </div>

        {rows.length === 0 ? (
          <p
            className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm"
            data-testid="documents-empty"
          >
            {EMPTY_DOCUMENTS_MESSAGE}
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="documents-list">
            {rows.map((row) => (
              <li key={row.documentId}>
                <a
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-indigo-300 hover:shadow-md"
                  data-testid={`document-row-${row.documentId}`}
                  href={row.href}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
                      return;
                    }

                    event.preventDefault();
                    onOpen({ kind: 'review', documentId: row.documentId });
                  }}
                >
                  <span>
                    <span className="flex items-center gap-1.5">
                      <span
                        className="block text-sm font-medium text-slate-900"
                        data-testid="document-title"
                      >
                        {row.title}
                      </span>
                      {row.disambiguator !== null && (
                        <span
                          className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500"
                          data-testid="document-disambiguator"
                          title="Another workflow shares this title -- this tag tells them apart."
                        >
                          #{row.disambiguator}
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-slate-500" data-testid="document-detail">
                      {row.detail} · created {row.createdAt}
                    </span>
                  </span>

                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[row.tone]}`}
                    data-testid="document-status"
                  >
                    {row.statusLabel}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
