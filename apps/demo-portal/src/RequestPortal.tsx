import { useState, type FormEvent } from 'react';

import { findServiceRequest, type ServiceRequest } from './data/service-requests';

/**
 * The three states of the request portal.
 *
 * Modelled as a discriminated union so the found result and the not-found
 * notice cannot both exist: "these two must never appear at the same time" is
 * enforced by the type, not by conditional styling that could drift.
 */
type SearchState =
  | { readonly status: 'initial' }
  | { readonly status: 'found'; readonly request: ServiceRequest }
  | { readonly status: 'not_found'; readonly requestNumber: string };

export function RequestPortal() {
  const [requestNumber, setRequestNumber] = useState('');
  const [search, setSearch] = useState<SearchState>({ status: 'initial' });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = requestNumber.trim();

    // A blank box is not an unknown request number; nothing has been searched.
    if (trimmed.length === 0) {
      setSearch({ status: 'initial' });
      return;
    }

    const match = findServiceRequest(trimmed);

    setSearch(
      match === undefined
        ? { status: 'not_found', requestNumber: trimmed }
        : { status: 'found', request: match },
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-slate-900">Service Request Portal</h1>
      <p className="mt-2 text-sm text-slate-600">
        Look up a service request by its request number.
      </p>

      <form className="mt-6 flex flex-wrap items-end gap-3" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-slate-900" htmlFor="request-number">
            Service request number
          </label>
          <input
            autoComplete="off"
            className="w-64 rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
            data-testid="request-number-input"
            id="request-number"
            name="requestNumber"
            onChange={(event) => setRequestNumber(event.target.value)}
            type="text"
            value={requestNumber}
          />
        </div>

        <button
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          data-testid="search-request-button"
          type="submit"
        >
          Search
        </button>
      </form>

      {search.status === 'found' && (
        <section
          aria-live="polite"
          className="mt-8 rounded border border-slate-200 p-4"
          data-testid="request-result"
          role="status"
        >
          <h2 className="text-lg font-semibold text-slate-900">Service request</h2>

          <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="font-medium text-slate-600">Request number</dt>
            <dd className="text-slate-900" data-testid="request-number-result">
              {search.request.requestNumber}
            </dd>

            <dt className="font-medium text-slate-600">Status</dt>
            <dd className="text-slate-900" data-testid="request-status">
              {search.request.status}
            </dd>

            <dt className="font-medium text-slate-600">Assigned team</dt>
            <dd className="text-slate-900" data-testid="assigned-team">
              {search.request.assignedTeam}
            </dd>
          </dl>
        </section>
      )}

      {search.status === 'not_found' && (
        <section
          aria-live="polite"
          className="mt-8 rounded border border-amber-300 bg-amber-50 p-4"
          data-testid="request-not-found"
          role="status"
        >
          <h2 className="text-lg font-semibold text-slate-900">No matching service request</h2>
          <p className="mt-1 text-sm text-slate-700">
            No service request was found for {search.requestNumber}.
          </p>
        </section>
      )}
    </main>
  );
}
