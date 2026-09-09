import { Bookmark, BookPlus, Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { driftedTestId } from '../server/demo-drift';
import { Layout } from '../components/Layout';
import {
  searchCatalog,
  type CatalogCategory,
  type CatalogItem,
  type CatalogStatus,
} from '../data/catalog';
import { describeEligibilityReason, evaluateEligibility, findMember } from '../data/members';
import { paginate, totalPages } from '../data/pagination';

const PAGE_SIZE = 10;
const LOAN_PERIOD_DAYS = 21;

type CategoryFilter = 'All' | CatalogCategory;
type StatusFilter = 'All' | CatalogStatus;
type SortKey = 'title' | 'author';

function describeStatus(status: CatalogStatus, dueDate: string | undefined): string {
  switch (status) {
    case 'available':
      return 'Available';
    case 'on_hold':
      return 'On hold';
    case 'on_loan':
      return `On loan · due ${dueDate}`;
  }
}

const CATEGORY_BADGE: Record<CatalogCategory, string> = {
  Fiction: 'rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700',
  Nonfiction: 'rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-700',
};

const STATUS_BADGE: Record<CatalogStatus, string> = {
  available: 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700',
  on_loan: 'rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700',
  on_hold: 'rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700',
};

const SELECT_CLASS = 'rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900';

/** Reads a `?q=` deep link from the homepage hero search, if present. */
function initialQuery(): string {
  return new URLSearchParams(window.location.search).get('q') ?? '';
}

interface BorrowRecord {
  readonly dueDate: string;
  readonly borrowerName: string;
}

type BorrowOutcome =
  | { readonly kind: 'success'; readonly name: string }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'ineligible'; readonly reason: string };

function describeBorrowOutcome(outcome: BorrowOutcome): string {
  switch (outcome.kind) {
    case 'success':
      return `Borrowed by ${outcome.name}.`;
    case 'not_found':
      return 'No member was found for that ID.';
    case 'ineligible':
      return `Not eligible to borrow — ${outcome.reason}`;
  }
}

type HoldOutcome =
  | { readonly kind: 'success'; readonly name: string; readonly position: number }
  | { readonly kind: 'already_in_queue'; readonly position: number }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'ineligible'; readonly reason: string };

function describeHoldOutcome(outcome: HoldOutcome): string {
  switch (outcome.kind) {
    case 'success':
      return `${outcome.name} is #${outcome.position} in line for this title.`;
    case 'already_in_queue':
      return `Already in line for this title, at position #${outcome.position}.`;
    case 'not_found':
      return 'No member was found for that ID.';
    case 'ineligible':
      return `Not eligible to place a hold — ${outcome.reason}`;
  }
}

function outcomeClass(succeeded: boolean): string {
  return succeeded ? 'mt-2 text-sm text-emerald-700' : 'mt-2 text-sm text-amber-700';
}

/** A checkout happening right now gets a due date 21 days out, computed once at the moment of borrowing. */
function computeDueDate(): string {
  const due = new Date();
  due.setDate(due.getDate() + LOAN_PERIOD_DAYS);
  return due.toISOString().slice(0, 10);
}

interface CatalogRowProps {
  readonly item: CatalogItem;
  readonly borrowRecord: BorrowRecord | undefined;
  readonly holders: readonly string[];
  readonly onBorrow: (isbn: string, memberId: string) => BorrowOutcome;
  readonly onHold: (isbn: string, memberId: string) => HoldOutcome;
}

function CatalogRow({ item, borrowRecord, holders, onBorrow, onHold }: CatalogRowProps) {
  const [borrowMemberId, setBorrowMemberId] = useState('');
  const [borrowOutcome, setBorrowOutcome] = useState<BorrowOutcome | undefined>(undefined);
  const [holdMemberId, setHoldMemberId] = useState('');
  const [holdOutcome, setHoldOutcome] = useState<HoldOutcome | undefined>(undefined);

  const effectiveStatus: CatalogStatus = borrowRecord ? 'on_loan' : item.status;
  const effectiveDueDate = borrowRecord?.dueDate ?? item.dueDate;

  function handleBorrow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = borrowMemberId.trim();
    if (trimmed.length === 0) {
      return;
    }

    setBorrowOutcome(onBorrow(item.isbn, trimmed));
  }

  function handleHold(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = holdMemberId.trim();
    if (trimmed.length === 0) {
      return;
    }

    setHoldOutcome(onHold(item.isbn, trimmed));
  }

  return (
    <div className="p-4 transition-colors hover:bg-slate-50" data-testid="catalog-result-item">
      <div className="flex flex-wrap items-center gap-2">
        <p
          className="font-serif text-sm font-semibold text-slate-900"
          data-testid="catalog-result-title"
        >
          {item.title}
        </p>
        <span className={CATEGORY_BADGE[item.category]}>{item.category}</span>
      </div>
      <p className="mt-0.5 text-sm text-slate-600">{item.author}</p>
      <span
        className={`mt-2 inline-block ${STATUS_BADGE[effectiveStatus]}`}
        data-testid="catalog-result-status"
      >
        {describeStatus(effectiveStatus, effectiveDueDate)}
      </span>

      {effectiveStatus === 'available' && (
        <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={handleBorrow}>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-700" htmlFor={`borrow-${item.isbn}`}>
              Member ID to borrow
            </label>
            <input
              autoComplete="off"
              className="w-40 rounded border border-slate-300 px-2 py-1 text-sm text-slate-900"
              data-testid="catalog-borrow-input"
              id={`borrow-${item.isbn}`}
              onChange={(event) => setBorrowMemberId(event.target.value)}
              type="text"
              value={borrowMemberId}
            />
          </div>

          <button
            className="flex items-center gap-1.5 rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
            data-testid="catalog-borrow-button"
            type="submit"
          >
            <BookPlus aria-hidden="true" className="h-3.5 w-3.5" />
            Borrow
          </button>
        </form>
      )}

      {/* Rendered outside the 'available' branch above: a successful borrow flips
          effectiveStatus to 'on_loan' in the same render, and the confirmation
          must survive that instead of unmounting along with the form. */}
      {borrowOutcome && (
        <p
          className={outcomeClass(borrowOutcome.kind === 'success')}
          data-testid="catalog-borrow-result"
        >
          {describeBorrowOutcome(borrowOutcome)}
        </p>
      )}

      {effectiveStatus === 'on_loan' && (
        <>
          <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={handleHold}>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-700" htmlFor={`hold-${item.isbn}`}>
                Member ID to place a hold
              </label>
              <input
                autoComplete="off"
                className="w-40 rounded border border-slate-300 px-2 py-1 text-sm text-slate-900"
                data-testid="catalog-hold-input"
                id={`hold-${item.isbn}`}
                onChange={(event) => setHoldMemberId(event.target.value)}
                type="text"
                value={holdMemberId}
              />
            </div>

            <button
              className="flex items-center gap-1.5 rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400"
              data-testid="catalog-hold-button"
              type="submit"
            >
              <Bookmark aria-hidden="true" className="h-3.5 w-3.5" />
              Place a hold
            </button>

            {holders.length > 0 && (
              <span className="text-xs text-slate-500" data-testid="catalog-hold-queue-count">
                {holders.length} {holders.length === 1 ? 'member' : 'members'} waiting
              </span>
            )}
          </form>

          {holdOutcome && (
            <p
              className={outcomeClass(holdOutcome.kind === 'success')}
              data-testid="catalog-hold-result"
            >
              {describeHoldOutcome(holdOutcome)}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function CatalogPage() {
  const [queryInput, setQueryInput] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('All');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [sortKey, setSortKey] = useState<SortKey>('title');
  const [page, setPage] = useState(1);
  const [borrowed, setBorrowed] = useState<Record<string, BorrowRecord>>({});
  const [holds, setHolds] = useState<Record<string, readonly string[]>>({});

  function effectiveStatusOf(item: CatalogItem): CatalogStatus {
    return borrowed[item.isbn] ? 'on_loan' : item.status;
  }

  const searched = searchCatalog(submittedQuery);
  const filtered = searched
    .filter((item) => categoryFilter === 'All' || item.category === categoryFilter)
    .filter((item) => statusFilter === 'All' || effectiveStatusOf(item) === statusFilter);
  const matches = [...filtered].sort((a, b) =>
    sortKey === 'author' ? a.author.localeCompare(b.author) : a.title.localeCompare(b.title),
  );

  const pageCount = totalPages(matches.length, PAGE_SIZE);
  const currentPage = Math.min(page, pageCount);
  const shown = paginate(matches, currentPage, PAGE_SIZE);
  const firstShownIndex = matches.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const lastShownIndex = firstShownIndex + shown.length - 1;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittedQuery(queryInput);
    setPage(1);
  }

  function handleBorrow(isbn: string, memberId: string): BorrowOutcome {
    const member = findMember(memberId);

    if (member === undefined) {
      return { kind: 'not_found' };
    }

    const eligibility = evaluateEligibility(member);

    if (!eligibility.eligible) {
      return { kind: 'ineligible', reason: describeEligibilityReason(eligibility.reason) };
    }

    setBorrowed((current) => ({
      ...current,
      [isbn]: { dueDate: computeDueDate(), borrowerName: member.name },
    }));

    return { kind: 'success', name: member.name };
  }

  function handleHold(isbn: string, memberId: string): HoldOutcome {
    const member = findMember(memberId);

    if (member === undefined) {
      return { kind: 'not_found' };
    }

    const eligibility = evaluateEligibility(member);

    if (!eligibility.eligible) {
      return { kind: 'ineligible', reason: describeEligibilityReason(eligibility.reason) };
    }

    const existing = holds[isbn] ?? [];
    const existingPosition = existing.indexOf(member.name);

    if (existingPosition !== -1) {
      return { kind: 'already_in_queue', position: existingPosition + 1 };
    }

    const updated = [...existing, member.name];
    setHolds((current) => ({ ...current, [isbn]: updated }));

    return { kind: 'success', name: member.name, position: updated.length };
  }

  return (
    <Layout current="catalog">
      <div className="mx-auto max-w-3xl px-8 py-12">
        <h1 className="font-serif text-2xl font-semibold text-slate-900">Catalog search</h1>
        <p className="mt-2 text-sm text-slate-600">
          Search our 100-title collection by title or ISBN, or browse all of it below. A member in
          good standing may borrow an available title, or place a hold on one that's on loan, with
          their member ID.
        </p>

        <form className="mt-6 flex flex-wrap items-end gap-3" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-900" htmlFor="catalog-search">
              Title or ISBN
            </label>
            <input
              autoComplete="off"
              className="w-72 rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
              data-testid="catalog-search-input"
              id="catalog-search"
              name="query"
              onChange={(event) => setQueryInput(event.target.value)}
              type="text"
              value={queryInput}
            />
          </div>

          <button
            className="flex items-center gap-1.5 rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            data-testid={driftedTestId('catalog-search-button')}
            type="submit"
          >
            <Search aria-hidden="true" className="h-4 w-4" />
            Search
          </button>
        </form>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-700" htmlFor="catalog-filter-category">
              Category
            </label>
            <select
              className={SELECT_CLASS}
              data-testid="catalog-filter-category"
              id="catalog-filter-category"
              onChange={(event) => {
                setCategoryFilter(event.target.value as CategoryFilter);
                setPage(1);
              }}
              value={categoryFilter}
            >
              <option value="All">All</option>
              <option value="Fiction">Fiction</option>
              <option value="Nonfiction">Nonfiction</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-700" htmlFor="catalog-filter-status">
              Status
            </label>
            <select
              className={SELECT_CLASS}
              data-testid="catalog-filter-status"
              id="catalog-filter-status"
              onChange={(event) => {
                setStatusFilter(event.target.value as StatusFilter);
                setPage(1);
              }}
              value={statusFilter}
            >
              <option value="All">All</option>
              <option value="available">Available</option>
              <option value="on_loan">On loan</option>
              <option value="on_hold">On hold</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-700" htmlFor="catalog-sort">
              Sort by
            </label>
            <select
              className={SELECT_CLASS}
              data-testid="catalog-sort"
              id="catalog-sort"
              onChange={(event) => setSortKey(event.target.value as SortKey)}
              value={sortKey}
            >
              <option value="title">Title (A–Z)</option>
              <option value="author">Author (A–Z)</option>
            </select>
          </div>
        </div>

        {matches.length > 0 && (
          <section
            aria-live="polite"
            className="mt-6 divide-y divide-slate-200 rounded border border-slate-200 shadow-sm"
            data-testid="catalog-results"
          >
            {shown.map((item) => (
              <CatalogRow
                borrowRecord={borrowed[item.isbn]}
                holders={holds[item.isbn] ?? []}
                item={item}
                key={item.isbn}
                onBorrow={handleBorrow}
                onHold={handleHold}
              />
            ))}
          </section>
        )}

        {matches.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
            <p data-testid="catalog-page-info">
              Showing {firstShownIndex}–{lastShownIndex} of {matches.length}
            </p>

            <div className="flex gap-2">
              <button
                className="rounded border border-slate-300 px-3 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                data-testid="catalog-prev-page"
                disabled={currentPage <= 1}
                onClick={() => setPage((current) => current - 1)}
                type="button"
              >
                Previous
              </button>
              <button
                className="rounded border border-slate-300 px-3 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                data-testid="catalog-next-page"
                disabled={currentPage >= pageCount}
                onClick={() => setPage((current) => current + 1)}
                type="button"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {matches.length === 0 && (
          <section
            aria-live="polite"
            className="mt-8 rounded border border-amber-300 bg-amber-50 p-4"
            data-testid="catalog-no-results"
            role="status"
          >
            <p className="text-sm text-slate-700">
              No catalog item matched the current search and filters.
            </p>
          </section>
        )}
      </div>
    </Layout>
  );
}
