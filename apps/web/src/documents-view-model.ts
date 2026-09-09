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
  /**
   * A short, stable tag distinguishing this row from another with the same
   * title, or `null` when the title is unique in the list.
   *
   * Set by `documentRows`, never by `toDocumentRow`: telling two rows apart is
   * a property of the list they sit in, not of either document alone. A title
   * is whatever a person typed or a recording session was named, and nothing
   * stops two workflows sharing one -- the date shown alongside a row is only
   * day-granular, so two same-titled documents made the same day were
   * otherwise indistinguishable without opening each one.
   */
  readonly disambiguator: string | null;
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
    // Whether this collides with a sibling is not this function's to know --
    // `documentRows` fills it in once every row in the list is in hand.
    disambiguator: null,
  };
}

/**
 * The tail of a document id, uppercased -- opaque, but always different for
 * two different documents, which a shared title and a same-day creation date
 * are not guaranteed to be.
 */
function shortId(documentId: string): string {
  return documentId.slice(-6).toUpperCase();
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
  const rows = [...summaries]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map(toDocumentRow);

  const titleCounts = new Map<string, number>();
  for (const row of rows) {
    titleCounts.set(row.title, (titleCounts.get(row.title) ?? 0) + 1);
  }

  return rows.map((row) =>
    (titleCounts.get(row.title) ?? 0) > 1
      ? { ...row, disambiguator: shortId(row.documentId) }
      : row,
  );
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
