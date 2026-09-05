import { useEffect, useState } from 'react';

import type { RunDetailView } from '@orbit/api/views';

import { ApiRequestError, fetchArtifact } from './api-client';
import {
  classifyEvidenceFailure,
  describeEvidence,
  EVIDENCE_FAILURE_MESSAGES,
  type EvidenceFailure,
  type EvidenceItem,
} from './run-view-model';

export interface EvidenceListProps {
  readonly run: RunDetailView;
}

/**
 * The evidence a run produced.
 *
 * Only a screenshot is shown in place. An HTML snapshot is a captured copy of
 * another page and is offered as a download, never rendered inside Watchtower —
 * the API refuses to serve it inline for the same reason, so this is the second
 * of two independent guards rather than the only one.
 */
export function EvidenceList({ run }: EvidenceListProps) {
  const items = describeEvidence(run.artifacts);

  return (
    <section className="rounded border border-slate-200 p-4" data-testid="evidence-list">
      <h3 className="text-sm font-semibold text-slate-900">Evidence</h3>

      {items.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500" data-testid="evidence-empty">
          No evidence has been recorded for this run yet.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {items.map((item) => (
            <li
              className="rounded border border-slate-200 p-3"
              data-testid="evidence-row"
              key={item.id}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-slate-900" data-testid="evidence-label">
                  {item.label}
                </span>
                <span className="text-xs text-slate-500">
                  {item.sizeLabel} · {item.contentType} · sha256 {item.digest}
                </span>
              </div>

              <p className="mt-1 text-xs text-slate-500">{item.roles.join(', ')}</p>

              {item.action === 'preview' ? (
                <ScreenshotPreview item={item} />
              ) : (
                <a
                  className="mt-2 inline-block rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-900"
                  data-testid={`evidence-download-${item.kind}`}
                  download
                  href={item.url}
                >
                  Download {item.label.toLowerCase()}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type PreviewState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly objectUrl: string }
  | { readonly kind: 'failed'; readonly failure: EvidenceFailure };

/**
 * Fetches the bytes rather than pointing an `<img>` at the URL.
 *
 * An `<img>` reports only that loading failed. Going through the API client
 * keeps the server's typed error code, which is what lets a checksum failure be
 * reported as an integrity problem instead of a missing file.
 */
function ScreenshotPreview({ item }: { readonly item: EvidenceItem }) {
  const [state, setState] = useState<PreviewState>({ kind: 'idle' });

  useEffect(() => {
    return () => {
      if (state.kind === 'ready') {
        URL.revokeObjectURL(state.objectUrl);
      }
    };
  }, [state]);

  async function show() {
    setState({ kind: 'loading' });

    try {
      const blob = await fetchArtifact(item.url);
      setState({ kind: 'ready', objectUrl: URL.createObjectURL(blob) });
    } catch (caught) {
      const failure =
        caught instanceof ApiRequestError
          ? classifyEvidenceFailure(caught.status, caught.code)
          : 'unavailable';
      setState({ kind: 'failed', failure });
    }
  }

  return (
    <div className="mt-2">
      {state.kind !== 'ready' && (
        <button
          className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-900 disabled:opacity-50"
          data-testid="evidence-show-screenshot"
          disabled={state.kind === 'loading'}
          onClick={() => void show()}
          type="button"
        >
          {state.kind === 'loading' ? 'Loading…' : 'Show screenshot'}
        </button>
      )}

      {state.kind === 'ready' && (
        <img
          alt={`${item.label} evidence for this run`}
          className="mt-2 max-h-96 w-full rounded border border-slate-200 object-contain object-top"
          data-testid="evidence-screenshot"
          src={state.objectUrl}
        />
      )}

      {state.kind === 'failed' && (
        <p className="mt-2 text-xs text-rose-700" data-testid="evidence-failure">
          {EVIDENCE_FAILURE_MESSAGES[state.failure]}
        </p>
      )}
    </div>
  );
}
