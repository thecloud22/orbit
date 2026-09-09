import type { SopDocumentSummaryView } from '@orbit/api/views';
import { describe, expect, it } from 'vitest';

import { documentRows, EMPTY_DOCUMENTS_MESSAGE, toDocumentRow } from './documents-view-model';

function summary(overrides: Partial<SopDocumentSummaryView> = {}): SopDocumentSummaryView {
  return {
    documentId: 'sopdoc_1',
    title: 'Escalation review',
    status: 'draft',
    revisionCount: 1,
    stepCount: 26,
    publishedVersion: null,
    createdAt: '2026-09-06T12:00:00.000Z',
    ...overrides,
  };
}

describe('toDocumentRow', () => {
  it('links to the document’s own review page', () => {
    expect(toDocumentRow(summary()).href).toBe('?documentId=sopdoc_1');
  });

  it('reads status as English', () => {
    expect(toDocumentRow(summary({ status: 'needs_clarification' })).statusLabel).toBe(
      'Needs clarification',
    );
    expect(toDocumentRow(summary({ status: 'in_review' })).statusLabel).toBe('In review');
  });

  it('says so when a document has no live revision', () => {
    const row = toDocumentRow(summary({ status: null }));

    expect(row.statusLabel).toBe('No revision');
    expect(row.tone).toBe('neutral');
  });

  it('passes an unknown status through rather than dropping it', () => {
    expect(toDocumentRow(summary({ status: 'something_new' })).statusLabel).toBe('something_new');
  });

  it('gives approved and attention states distinct tones', () => {
    expect(toDocumentRow(summary({ status: 'approved' })).tone).toBe('success');
    expect(toDocumentRow(summary({ status: 'rejected' })).tone).toBe('attention');
    expect(toDocumentRow(summary({ status: 'in_review' })).tone).toBe('progress');
  });

  it('summarises size in steps and revisions', () => {
    expect(toDocumentRow(summary()).detail).toBe('26 steps · 1 revision');
  });

  it('gets the singular right', () => {
    expect(toDocumentRow(summary({ stepCount: 1, revisionCount: 1 })).detail).toBe(
      '1 step · 1 revision',
    );
  });

  it('handles a document with no steps without saying something odd', () => {
    expect(toDocumentRow(summary({ stepCount: 0 })).detail).toContain('0 steps');
  });

  it('shows a malformed timestamp as-is rather than as Invalid Date', () => {
    expect(toDocumentRow(summary({ createdAt: 'not a date' })).createdAt).toBe('not a date');
  });
});

describe('documentRows', () => {
  it('puts the newest first', () => {
    // What a reader expects at the top is the thing they just made, and relying
    // on the endpoint's ordering would rely on something it never promised.
    const rows = documentRows([
      summary({ documentId: 'older', createdAt: '2026-09-01T00:00:00.000Z' }),
      summary({ documentId: 'newer', createdAt: '2026-09-06T00:00:00.000Z' }),
    ]);

    expect(rows.map((row) => row.documentId)).toEqual(['newer', 'older']);
  });

  it('does not mutate what it was given', () => {
    const input = [
      summary({ documentId: 'a', createdAt: '2026-09-01T00:00:00.000Z' }),
      summary({ documentId: 'b', createdAt: '2026-09-06T00:00:00.000Z' }),
    ];

    documentRows(input);

    expect(input.map((entry) => entry.documentId)).toEqual(['a', 'b']);
  });

  it('returns nothing for no documents', () => {
    expect(documentRows([])).toEqual([]);
  });

  it('gives no row a disambiguator when every title is unique', () => {
    const rows = documentRows([
      summary({ documentId: 'sopdoc_aaaaaa', title: 'Lib-003' }),
      summary({ documentId: 'sopdoc_bbbbbb', title: 'Lib-004' }),
    ]);

    expect(rows.every((row) => row.disambiguator === null)).toBe(true);
  });

  it('tags every row sharing a title with a short, distinct id', () => {
    // The real gap this closes: two workflows named the same thing, created
    // the same day (the date shown alongside a row is day-granular), were
    // otherwise impossible to tell apart in the list without opening each one.
    const rows = documentRows([
      summary({ documentId: 'sopdoc_01aaaaaa', title: 'Lib-004' }),
      summary({ documentId: 'sopdoc_01bbbbbb', title: 'Lib-004' }),
      summary({ documentId: 'sopdoc_01cccccc', title: 'Lib-003' }),
    ]);

    const [first, second, third] = rows;
    expect(first?.disambiguator).not.toBeNull();
    expect(second?.disambiguator).not.toBeNull();
    expect(first?.disambiguator).not.toBe(second?.disambiguator);
    // Unique title, so untouched even though it sits in the same list.
    expect(third?.disambiguator).toBeNull();
  });

  it('does not add a disambiguator for a duplicate document id, only a duplicate title', () => {
    // toDocumentRow always starts a row's disambiguator at null; documentRows
    // is the only thing that ever sets it, and only from a title collision.
    expect(toDocumentRow(summary()).disambiguator).toBeNull();
  });
});

describe('the empty state', () => {
  it('names the one way to create a workflow', () => {
    // Until a document exists there is no route into the review page at all,
    // which is the dead end this page was built to remove.
    expect(EMPTY_DOCUMENTS_MESSAGE).toContain('home page');
    expect(EMPTY_DOCUMENTS_MESSAGE).toContain('own words');
  });
});

describe('a workflow that is running', () => {
  it('reports the live version alongside the revision’s own status', () => {
    // Both facts, because they answer different questions. A published workflow
    // that has since been revised is genuinely a draft *revision* and genuinely
    // a running *agent*, and the list used to report only the first — so the
    // one thing this screen is most often scanned for was the one thing it
    // could not say.
    const row = toDocumentRow(summary({ status: 'draft', publishedVersion: '0.1.0' }));

    expect(row.publishedVersion).toBe('0.1.0');
    expect(row.statusLabel).toBe('Draft');
  });

  it('reports nothing live for a workflow that has never been published', () => {
    expect(toDocumentRow(summary()).publishedVersion).toBeNull();
  });
});
