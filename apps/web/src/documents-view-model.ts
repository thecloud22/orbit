import type { SopDocumentSummaryView } from '@orbit/api/views';

import { searchForView } from './navigation';

/**
 * Every decision the documents list makes, as pure functions.
 *
 * Same arrangement as the other view models here: the component renders what
 * these return and decides nothing itself.
 */

export type DocumentTone = 'neutral' | 'progress' | 'success' | 'attention';

export interface DocumentRow {
  readonly documentId: string;
  readonly title: string;
  readonly href: string;
  readonly statusLabel: string;
  readonly tone: DocumentTone;
  /** e.g. "26 steps · revision 3". */
  readonly detail: string;
  readonly createdAt: string;
}

const STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: 'Draft',
  needs_clarification: 'Needs clarification',
  in_review: 'In review',
  approved: 'Approved',
  rejected: 'Rejected',
  superseded: 'Superseded',
};

const STATUS_TONES: Readonly<Record<string, DocumentTone>> = {
  draft: 'neutral',
  needs_clarification: 'attention',
  in_review: 'progress',
  approved: 'success',
  rejected: 'attention',
};

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function toDocumentRow(summary: SopDocumentSummaryView): DocumentRow {
  const status = summary.status;

  return {
    documentId: summary.documentId,
    title: summary.title,
    href: searchForView({ kind: 'review', documentId: summary.documentId }),
    statusLabel: status === null ? 'No revision' : (STATUS_LABELS[status] ?? status),
    tone: status === null ? 'neutral' : (STATUS_TONES[status] ?? 'neutral'),
    detail: `${plural(summary.stepCount, 'step')} · ${plural(summary.revisionCount, 'revision')}`,
    createdAt: formatDate(summary.createdAt),
  };
}

/**
 * Newest first.
 *
 * The API returns documents in creation order already, but the list sorts
 * anyway: what a reader expects at the top is the thing they just made, and
 * depending on an endpoint's ordering for that is depending on something it
 * never promised.
 */
export function documentRows(summaries: readonly SopDocumentSummaryView[]): readonly DocumentRow[] {
  return [...summaries]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map(toDocumentRow);
}

/**
 * What to say when there is nothing to list.
 *
 * Naming the one way to create a document matters more here than anywhere else
 * in the app: until one exists there is no route into the review page at all,
 * which is exactly the dead end this page was built to remove.
 */
export const EMPTY_DOCUMENTS_MESSAGE =
  'No workflows yet. Describe one in your own words on the home page and Orbit will draft it.';

function formatDate(iso: string): string {
  const parsed = new Date(iso);

  // A malformed timestamp is shown as-is rather than as "Invalid Date": the raw
  // value is at least a clue about what went wrong.
  return Number.isNaN(parsed.getTime())
    ? iso
    : parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
