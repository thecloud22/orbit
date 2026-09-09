import { useEffect, useState } from 'react';

import { ApiRequestError, fetchArtifact } from '../api-client';
import {
  classifyEvidenceFailure,
  EVIDENCE_FAILURE_MESSAGES,
  type EvidenceFailure,
  type EvidenceItem,
} from '../runs/run-view-model';

/**
 * The evidence a run produced, rendered where it belongs.
 *
 * This used to be one list at the bottom of the run page, holding every
 * artifact from every step, which left the reader to work out by timestamp
 * which screenshot came from which action. Evidence is now rendered under the
 * step that captured it — `ArtifactView.runStepId` said which step that was all
 * along — and this file provides the pieces that do it: one group, one row, and
 * the screenshot preview.
 *
 * Only a screenshot is shown in place. An HTML snapshot is a captured copy of
 * another page and is offered as a download, never rendered inside Watchtower —
 * the API refuses to serve it inline for the same reason, so this is the second
 * of two independent guards rather than the only one.
 */

export interface EvidenceGroupProps {
  readonly items: readonly EvidenceItem[];
  /** Optional heading. Omitted when the group sits inside a step that names itself. */
  readonly title?: string;
  readonly testId?: string;
  readonly emptyMessage?: string;
}

export function EvidenceGroup({ items, title, testId, emptyMessage }: EvidenceGroupProps) {
  if (items.length === 0 && emptyMessage === undefined) {
    return null;
  }

  return (
    <div data-testid={testId}>
      {title !== undefined && (
        <h4 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</h4>
      )}

      {items.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500" data-testid="evidence-empty">
          {emptyMessage}
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {items.map((item) => (
            <EvidenceRow item={item} key={item.id} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function EvidenceRow({ item }: { readonly item: EvidenceItem }) {
  return (
    <li
      className="rounded-md border border-slate-200 bg-white p-3 transition-colors hover:border-slate-300"
      data-testid="evidence-row"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-slate-900" data-testid="evidence-label">
          {item.label}
        </span>
        <span className="font-mono text-xs text-slate-500">
          {item.sizeLabel} · {item.contentType} · sha256 {item.digest}
        </span>
      </div>

      <p className="mt-1 text-xs text-slate-500">{item.roles.join(', ')}</p>

      {item.action === 'preview' ? (
        <ScreenshotPreview item={item} />
      ) : (
        <a
          className="mt-2 inline-block rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-900 transition-colors hover:border-slate-400 hover:bg-slate-50"
          data-testid={`evidence-download-${item.kind}`}
          download
          href={item.url}
        >
          Download {item.label.toLowerCase()}
        </a>
      )}
    </li>
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
          className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-900 transition-colors hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50"
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
