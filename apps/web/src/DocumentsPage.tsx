import { useEffect, useState } from 'react';

import type { SopDocumentSummaryView } from '@orbit/api/views';

import { ApiRequestError, listSopDocuments } from './api-client';
import { documentRows, EMPTY_DOCUMENTS_MESSAGE, type DocumentTone } from './documents-view-model';
import type { View } from './navigation';

export interface DocumentsPageProps {
  readonly onOpen: (view: View) => void;
}

const TONE_CLASSES: Readonly<Record<DocumentTone, string>> = {
  neutral: 'bg-slate-100 text-slate-700',
  progress: 'bg-sky-50 text-sky-900',
  success: 'bg-emerald-50 text-emerald-900',
  attention: 'bg-amber-50 text-amber-900',
};

/**
 * Every SOP Graph document, each one a link to its review page.
 *
 * The endpoint behind this has existed since sub-phase 2.3 and nothing ever
 * called it, so a workflow was unreachable unless you already knew its id —
 * which is why Watchtower looked like it had lost the features built on top of
 * it. Read-only: documents are created by drafting one on the home page.
 */
export function DocumentsPage({ onOpen }: DocumentsPageProps) {
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
    <section className="flex flex-col gap-3" data-testid="documents-page">
      <h2 className="text-sm font-semibold text-slate-900">Workflows</h2>

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
                  <span
                    className="block text-sm font-medium text-slate-900"
                    data-testid="document-title"
                  >
                    {row.title}
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
  );
}
