export type CatalogStatus = 'available' | 'on_loan' | 'on_hold';
export type CatalogCategory = 'Fiction' | 'Nonfiction';

export interface CatalogItem {
  readonly isbn: string;
  readonly title: string;
  readonly author: string;
  readonly category: CatalogCategory;
  readonly status: CatalogStatus;
  /** Only present for 'on_loan'. A stored fact, not derived from a clock — see below. */
  readonly dueDate?: string;
}

/**
 * Five hand-authored "flagship" records, kept searchable by their exact
 * title and ISBN so existing lookups and tests stay stable regardless of how
 * the rest of the catalog is generated.
 */
const FLAGSHIP_ITEMS: readonly CatalogItem[] = Object.freeze([
  Object.freeze({
    isbn: '978-0-13-235088-4',
    title: 'Clean Code',
    author: 'Robert C. Martin',
    category: 'Nonfiction',
    status: 'available',
  }),
  Object.freeze({
    isbn: '978-0-201-63361-0',
    title: 'Design Patterns',
    author: 'Gamma, Helm, Johnson, Vlissides',
    category: 'Nonfiction',
    status: 'on_loan',
    dueDate: '2024-06-20',
  }),
  Object.freeze({
    isbn: '978-0-13-595705-9',
    title: 'The Pragmatic Programmer',
    author: 'David Thomas, Andrew Hunt',
    category: 'Nonfiction',
    status: 'on_hold',
  }),
  Object.freeze({
    isbn: '978-1-4919-5035-7',
    title: 'Building Microservices',
    author: 'Sam Newman',
    category: 'Nonfiction',
    status: 'available',
  }),
  Object.freeze({
    isbn: '978-0-596-00712-6',
    title: 'Head First Design Patterns',
    author: 'Eric Freeman, Elisabeth Robson',
    category: 'Nonfiction',
    status: 'on_loan',
    dueDate: '2024-06-01',
  }),
]) as readonly CatalogItem[];

const ADJECTIVES = [
  'Silent',
  'Hidden',
  'Last',
  'Forgotten',
  'Golden',
  'Broken',
  'Quiet',
  'Distant',
  'Endless',
  'Secret',
  'Long',
  'Final',
  'Lost',
  'Deep',
  'Bright',
] as const;

const NOUNS = [
  'Orchard',
  'River',
  'Garden',
  'City',
  'Harbor',
  'Mountain',
  'Kingdom',
  'Forest',
  'Ocean',
  'Bridge',
  'Valley',
  'Station',
  'Archive',
  'Lighthouse',
  'Meridian',
] as const;

const NONFICTION_SUBJECTS = [
  'Modern Physics',
  'Ancient Rome',
  'Machine Learning',
  'World Economics',
  'Urban Planning',
  'Marine Biology',
  'Classical Music',
  'Renaissance Art',
  'Organic Chemistry',
  'Constitutional Law',
] as const;

const NONFICTION_TEMPLATES = [
  'Principles of {subject}',
  'A History of {subject}',
  'Introduction to {subject}',
  'Understanding {subject}',
] as const;

const FIRST_NAMES = [
  'Maria',
  'James',
  'Wei',
  'Fatima',
  'Daniel',
  'Elena',
  'Samuel',
  'Priya',
  'Thomas',
  'Ingrid',
  'Carlos',
  'Nadia',
  'Peter',
  'Aisha',
  'Lucas',
] as const;

const LAST_NAMES = [
  'Alvarez',
  'Chen',
  'Okafor',
  'Novak',
  'Whitfield',
  'Marsh',
  'Delgado',
  'Kapoor',
  'Reyes',
  'Larsson',
  'Duarte',
  'Petrov',
  'Byrne',
  'Osei',
  'Hoffmann',
] as const;

const DUE_DATES = ['2024-06-05', '2024-06-12', '2024-06-18', '2024-06-25', '2024-07-02'] as const;

/**
 * Builds one generated catalog record from a plain index.
 *
 * Everything is a pure function of the index — title, author, ISBN, and
 * status all cycle through fixed word banks and modulo arithmetic, so the
 * generated catalog is identical on every load with no randomness and no
 * clock dependency.
 */
function generatedItem(index: number): CatalogItem {
  const isFiction = index % 2 === 0;

  const title = isFiction
    ? `The ${ADJECTIVES[index % ADJECTIVES.length]} ${NOUNS[Math.floor(index / ADJECTIVES.length) % NOUNS.length]}`
    : NONFICTION_TEMPLATES[
        Math.floor(index / NONFICTION_SUBJECTS.length) % NONFICTION_TEMPLATES.length
      ]!.replace('{subject}', NONFICTION_SUBJECTS[index % NONFICTION_SUBJECTS.length]!);

  const author = `${FIRST_NAMES[index % FIRST_NAMES.length]} ${LAST_NAMES[Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length]}`;
  const isbn = `978-1-${String(100000 + index).padStart(6, '0')}-${index % 10}`;
  const category: CatalogCategory = isFiction ? 'Fiction' : 'Nonfiction';

  // 70% available, 20% on loan, 10% on hold — a fixed distribution by
  // position, not a random draw, so the same index always lands the same way.
  const slot = index % 10;

  if (slot < 7) {
    return { isbn, title, author, category, status: 'available' };
  }

  if (slot < 9) {
    return {
      isbn,
      title,
      author,
      category,
      status: 'on_loan',
      dueDate: DUE_DATES[Math.floor(index / 10) % DUE_DATES.length]!,
    };
  }

  return { isbn, title, author, category, status: 'on_hold' };
}

const GENERATED_ITEMS: readonly CatalogItem[] = Object.freeze(
  Array.from({ length: 95 }, (_, index) => Object.freeze(generatedItem(index))),
);

/**
 * The full seeded catalog: 5 hand-authored records plus 95 generated ones,
 * for a round 100 titles. In-memory, read-only, never mutated.
 */
export const CATALOG: readonly CatalogItem[] = Object.freeze([
  ...FLAGSHIP_ITEMS,
  ...GENERATED_ITEMS,
]) as readonly CatalogItem[];

/**
 * Normalizes an ISBN for comparison by lowercasing and dropping separators,
 * so '978-0-13-235088-4' and '9780132350884' match the same seeded record.
 */
function normalizeIsbn(value: string): string {
  return value.toLowerCase().replace(/[^0-9x]/g, '');
}

/** Searches the catalog by title substring or exact ISBN, case-insensitively on both. */
export function searchCatalog(query: string): readonly CatalogItem[] {
  const trimmed = query.trim();

  if (trimmed.length === 0) {
    return CATALOG;
  }

  const normalizedIsbn = normalizeIsbn(trimmed);
  const lowerTitle = trimmed.toLowerCase();

  return CATALOG.filter(
    (item) =>
      item.title.toLowerCase().includes(lowerTitle) || normalizeIsbn(item.isbn) === normalizedIsbn,
  );
}
