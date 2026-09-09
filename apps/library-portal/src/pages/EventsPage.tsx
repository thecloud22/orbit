import { CalendarDays, Clock, MapPin, UserPlus, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { Layout } from '../components/Layout';
import { EVENTS, searchEventsByDate, type EventCategory, type LibraryEvent } from '../data/events';
import { describeEligibilityReason, evaluateEligibility, findMember } from '../data/members';

type CategoryFilter = 'All' | EventCategory;

const CATEGORY_BADGE: Record<EventCategory, string> = {
  Kids: 'rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-700',
  Teens: 'rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700',
  Adults: 'rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700',
  Community: 'rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700',
};

/** Formats a stored YYYY-MM-DD string for display; the date itself is fixed content, not the clock. */
function formatDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

type RegistrationOutcome =
  | { readonly kind: 'success'; readonly name: string }
  | { readonly kind: 'already_registered' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'ineligible'; readonly reason: string };

function describeOutcome(outcome: RegistrationOutcome): string {
  switch (outcome.kind) {
    case 'success':
      return `${outcome.name} is registered.`;
    case 'already_registered':
      return 'That member is already registered for this event.';
    case 'not_found':
      return 'No member was found for that ID.';
    case 'ineligible':
      return `Not eligible to register — ${outcome.reason}`;
  }
}

function outcomeClass(outcome: RegistrationOutcome): string {
  return outcome.kind === 'success'
    ? 'mt-2 text-sm text-emerald-700'
    : 'mt-2 text-sm text-amber-700';
}

function EventCard({ event }: { readonly event: LibraryEvent }) {
  const [memberIdInput, setMemberIdInput] = useState('');
  const [registered, setRegistered] = useState<readonly string[]>([]);
  const [outcome, setOutcome] = useState<RegistrationOutcome | undefined>(undefined);

  function handleRegister(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();

    const trimmed = memberIdInput.trim();
    if (trimmed.length === 0) {
      return;
    }

    const member = findMember(trimmed);

    if (member === undefined) {
      setOutcome({ kind: 'not_found' });
      return;
    }

    if (registered.includes(member.name)) {
      setOutcome({ kind: 'already_registered' });
      return;
    }

    const eligibility = evaluateEligibility(member);

    if (!eligibility.eligible) {
      setOutcome({ kind: 'ineligible', reason: describeEligibilityReason(eligibility.reason) });
      return;
    }

    setRegistered((current) => [...current, member.name]);
    setOutcome({ kind: 'success', name: member.name });
  }

  return (
    <li
      className="rounded border border-slate-200 p-5 shadow-sm transition-colors hover:bg-slate-50"
      data-testid="event-item"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-serif font-semibold text-slate-900" data-testid="event-title">
          {event.title}
        </p>
        <span className={CATEGORY_BADGE[event.category]}>{event.category}</span>
      </div>

      <p
        className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-700"
        data-testid="event-date"
      >
        <span className="flex items-center gap-1">
          <CalendarDays aria-hidden="true" className="h-3.5 w-3.5 text-slate-400" />
          {formatDate(event.date)}
        </span>
        <span className="flex items-center gap-1">
          <Clock aria-hidden="true" className="h-3.5 w-3.5 text-slate-400" />
          {event.time}
        </span>
        <span className="flex items-center gap-1">
          <MapPin aria-hidden="true" className="h-3.5 w-3.5 text-slate-400" />
          {event.location}
        </span>
      </p>
      <p className="mt-1 text-sm text-slate-600">{event.description}</p>

      <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={handleRegister}>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-700" htmlFor={`register-${event.id}`}>
            Member ID to register
          </label>
          <input
            autoComplete="off"
            className="w-40 rounded border border-slate-300 px-2 py-1 text-sm text-slate-900"
            data-testid="event-register-input"
            id={`register-${event.id}`}
            onChange={(inputEvent) => setMemberIdInput(inputEvent.target.value)}
            type="text"
            value={memberIdInput}
          />
        </div>

        <button
          className="flex items-center gap-1.5 rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
          data-testid="event-register-button"
          type="submit"
        >
          <UserPlus aria-hidden="true" className="h-3.5 w-3.5" />
          Register
        </button>
      </form>

      {outcome && (
        <p className={outcomeClass(outcome)} data-testid="event-register-result">
          {describeOutcome(outcome)}
        </p>
      )}

      {registered.length > 0 && (
        <ul className="mt-2 text-xs text-slate-500" data-testid="event-registered-list">
          {registered.map((name) => (
            <li data-testid="event-registered-name" key={name}>
              Registered: {name}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function EventsPage() {
  const [dateFilter, setDateFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('All');

  const matches = [...searchEventsByDate(dateFilter)]
    .filter((event) => categoryFilter === 'All' || event.category === categoryFilter)
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <Layout current="events">
      <div className="mx-auto max-w-3xl px-8 py-12">
        <h1 className="font-serif text-2xl font-semibold text-slate-900">Events</h1>
        <p className="mt-2 text-sm text-slate-600">
          {EVENTS.length} upcoming programs across all branches. A member in good standing may
          register with their member ID.
        </p>

        <div className="mt-6 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-900" htmlFor="event-date-filter">
              Filter by date
            </label>
            <input
              className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
              data-testid="event-date-filter-input"
              id="event-date-filter"
              onChange={(event) => setDateFilter(event.target.value)}
              type="date"
              value={dateFilter}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-900" htmlFor="event-category-filter">
              Category
            </label>
            <select
              className="rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              data-testid="event-category-filter"
              id="event-category-filter"
              onChange={(event) => setCategoryFilter(event.target.value as CategoryFilter)}
              value={categoryFilter}
            >
              <option value="All">All</option>
              <option value="Kids">Kids</option>
              <option value="Teens">Teens</option>
              <option value="Adults">Adults</option>
              <option value="Community">Community</option>
            </select>
          </div>

          <button
            className="flex items-center gap-1.5 rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400"
            data-testid="event-date-filter-clear"
            onClick={() => {
              setDateFilter('');
              setCategoryFilter('All');
            }}
            type="button"
          >
            <X aria-hidden="true" className="h-4 w-4" />
            Clear
          </button>
        </div>

        {matches.length > 0 ? (
          <ul className="mt-8 space-y-4" data-testid="events-list">
            {matches.map((event) => (
              <EventCard event={event} key={event.id} />
            ))}
          </ul>
        ) : (
          <section
            aria-live="polite"
            className="mt-8 rounded border border-amber-300 bg-amber-50 p-4"
            data-testid="events-no-results"
            role="status"
          >
            <p className="text-sm text-slate-700">No events are scheduled on that date.</p>
          </section>
        )}
      </div>
    </Layout>
  );
}
