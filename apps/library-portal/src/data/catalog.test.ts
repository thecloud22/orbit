import { describe, expect, it } from 'vitest';

import { CATALOG, searchCatalog } from './catalog';

describe('searchCatalog', () => {
  it('matches a title substring case-insensitively', () => {
    const results = searchCatalog('design patterns');

    expect(results.map((item) => item.title)).toEqual(
      expect.arrayContaining(['Design Patterns', 'Head First Design Patterns']),
    );
  });

  it('matches an exact ISBN regardless of separators', () => {
    const cleanCode = CATALOG.find((item) => item.title === 'Clean Code');

    expect(searchCatalog('9780132350884')).toEqual([cleanCode]);
    expect(searchCatalog('978-0-13-235088-4')).toEqual([cleanCode]);
  });

  it('returns an empty list for no match', () => {
    expect(searchCatalog('nonexistent title')).toEqual([]);
  });

  it('returns the full catalog for a blank query, so browsing needs no search term', () => {
    expect(searchCatalog('')).toEqual(CATALOG);
    expect(searchCatalog('   ')).toEqual(CATALOG);
  });

  it('reports on_loan items with their due date', () => {
    const [designPatterns] = searchCatalog('978-0-201-63361-0');

    expect(designPatterns).toMatchObject({ status: 'on_loan', dueDate: '2024-06-20' });
  });
});

describe('CATALOG', () => {
  it('seeds exactly 100 titles', () => {
    expect(CATALOG).toHaveLength(100);
  });

  it('has unique ISBNs', () => {
    const isbns = new Set(CATALOG.map((item) => item.isbn));
    expect(isbns.size).toBe(CATALOG.length);
  });

  it('has at least some titles in each status, including on hold', () => {
    const statuses = new Set(CATALOG.map((item) => item.status));
    expect(statuses).toEqual(new Set(['available', 'on_loan', 'on_hold']));
  });

  it('is frozen so the portal stays read-only', () => {
    expect(Object.isFrozen(CATALOG)).toBe(true);
    expect(Object.isFrozen(CATALOG[0])).toBe(true);
  });
});
