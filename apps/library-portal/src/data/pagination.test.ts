import { describe, expect, it } from 'vitest';

import { paginate, totalPages } from './pagination';

describe('paginate', () => {
  const items = Array.from({ length: 25 }, (_, i) => i + 1);

  it('returns the first page', () => {
    expect(paginate(items, 1, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('returns a middle page', () => {
    expect(paginate(items, 2, 10)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });

  it('returns a partial last page', () => {
    expect(paginate(items, 3, 10)).toEqual([21, 22, 23, 24, 25]);
  });

  it('returns an empty page past the end', () => {
    expect(paginate(items, 4, 10)).toEqual([]);
  });
});

describe('totalPages', () => {
  it('divides evenly', () => {
    expect(totalPages(100, 10)).toBe(10);
  });

  it('rounds up a partial final page', () => {
    expect(totalPages(25, 10)).toBe(3);
  });

  it('is never fewer than 1, even for an empty list', () => {
    expect(totalPages(0, 10)).toBe(1);
  });
});
