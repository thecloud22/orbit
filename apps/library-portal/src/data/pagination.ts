/** Slices a page (1-indexed) of `pageSize` items out of a larger list. */
export function paginate<T>(items: readonly T[], page: number, pageSize: number): readonly T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

/** Total number of pages for a list of `itemCount` items — never fewer than 1. */
export function totalPages(itemCount: number, pageSize: number): number {
  return Math.max(1, Math.ceil(itemCount / pageSize));
}
