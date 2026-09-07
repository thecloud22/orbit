import { useState, type FormEvent } from 'react';

import { Layout } from './components/Layout';
import {
  searchCatalog,
  type CatalogCategory,
  type CatalogItem,
  type CatalogStatus,
} from './data/catalog';
import { describeEligibilityReason, evaluateEligibility, findMember } from './data/members';
import { paginate, totalPages } from './data/pagination';

const PAGE_SIZE = 10;
const LOAN_PERIOD_DAYS = 21;

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

function borrowOutcomeClass(outcome: BorrowOutcome): string {
  return outcome.kind === 'success'
    ? 'mt-2 text-sm text-emerald-700'
    : 'mt-2 text-sm text-amber-700';
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
  readonly onBorrow: (isbn: string, memberId: string) => BorrowOutcome;
}

function CatalogRow({ item, borrowRecord, onBorrow }: CatalogRowProps) {
  const [memberIdInput, setMemberIdInput] = useState('');
  const [outcome, setOutcome] = useState<BorrowOutcome | undefined>(undefined);

  const effectiveStatus: CatalogStatus = borrowRecord ? 'on_loan' : item.status;
  const effectiveDueDate = borrowRecord?.dueDate ?? item.dueDate;

  function handleBorrow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = memberIdInput.trim();
    if (trimmed.length === 0) {
      return;
    }

    setOutcome(onBorrow(item.isbn, trimmed));
  }

  return (
    <div className="p-4" data-testid="catalog-result-item">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-slate-900" data-testid="catalog-result-title">
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
              onChange={(event) => setMemberIdInput(event.target.value)}
              type="text"
              value={memberIdInput}
            />
          </div>

          <button
            className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
            data-testid="catalog-borrow-button"
            type="submit"
          >
            Borrow
          </button>
        </form>
      )}

      {outcome && (
        <p className={borrowOutcomeClass(outcome)} data-testid="catalog-borrow-result">
          {describeBorrowOutcome(outcome)}
        </p>
      )}
    </div>
  );
}

export function CatalogPage() {
  const [queryInput, setQueryInput] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const [page, setPage] = useState(1);
  const [borrowed, setBorrowed] = useState<Record<string, BorrowRecord>>({});

  const matches = searchCatalog(submittedQuery);
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

  return (
    <Layout current="catalog">
      <div className="mx-auto max-w-3xl px-8 py-12">
        <h1 className="text-2xl font-semibold text-slate-900">Catalog search</h1>
        <p className="mt-2 text-sm text-slate-600">
          Search our 100-title collection by title or ISBN, or browse all of it below. A member in
          good standing may borrow an available title with their member ID.
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
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            data-testid="catalog-search-button"
            type="submit"
          >
            Search
          </button>
        </form>

        {matches.length > 0 && (
          <section
            aria-live="polite"
            className="mt-8 divide-y divide-slate-200 rounded border border-slate-200"
            data-testid="catalog-results"
          >
            {shown.map((item) => (
              <CatalogRow
                borrowRecord={borrowed[item.isbn]}
                item={item}
                key={item.isbn}
                onBorrow={handleBorrow}
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
              No catalog item matched &quot;{submittedQuery.trim()}&quot;.
            </p>
          </section>
        )}
      </div>
    </Layout>
  );
}
