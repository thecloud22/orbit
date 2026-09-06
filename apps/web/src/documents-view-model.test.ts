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
});

describe('the empty state', () => {
  it('names the one way to create a workflow', () => {
    // Until a document exists there is no route into the review page at all,
    // which is the dead end this page was built to remove.
    expect(EMPTY_DOCUMENTS_MESSAGE).toContain('home page');
    expect(EMPTY_DOCUMENTS_MESSAGE).toContain('own words');
  });
});
