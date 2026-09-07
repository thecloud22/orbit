import { AlertTriangle, CheckCircle2, Search, UserCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { Layout } from './components/Layout';
import {
  describeEligibilityReason,
  evaluateEligibility,
  findMember,
  MEMBERS,
  type Member,
} from './data/members';

const STANDING_BADGE = {
  eligible:
    'inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700',
  blocked:
    'inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700',
} as const;

/**
 * The three states of a circulation desk lookup, modelled as a discriminated
 * union for the same reason as the Phase 1 request portal: "found" and
 * "not found" must never render at once, and the type guarantees it.
 */
type LookupState =
  | { readonly status: 'initial' }
  | { readonly status: 'found'; readonly member: Member }
  | { readonly status: 'not_found'; readonly memberId: string };

export function CirculationPage() {
  const [memberId, setMemberId] = useState('');
  const [lookup, setLookup] = useState<LookupState>({ status: 'initial' });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = memberId.trim();

    if (trimmed.length === 0) {
      setLookup({ status: 'initial' });
      return;
    }

    const member = findMember(trimmed);

    setLookup(
      member === undefined
        ? { status: 'not_found', memberId: trimmed }
        : { status: 'found', member },
    );
  }

  return (
    <Layout current="circulation">
      <div className="mx-auto max-w-3xl px-8 py-12">
        <h1 className="font-serif text-2xl font-semibold text-slate-900">Circulation desk</h1>
        <p className="mt-2 text-sm text-slate-600">
          Look up a member's standing and borrowing eligibility by member ID.
        </p>

        <div className="mt-6 flex items-center gap-2 text-sm text-slate-600">
          <UserCheck aria-hidden="true" className="h-4 w-4 text-indigo-600" />
          <span data-testid="member-directory-summary">
            {MEMBERS.filter((member) => evaluateEligibility(member).eligible).length} of{' '}
            {MEMBERS.length} members in good standing
          </span>
        </div>

        <h2 className="mt-4 font-serif text-lg font-semibold text-slate-900">All members</h2>
        <div className="mt-3 overflow-x-auto rounded border border-slate-200 shadow-sm">
          <table className="w-full text-left text-sm" data-testid="member-directory-list">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2 font-medium">Member ID</th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Active loans</th>
                <th className="px-4 py-2 font-medium">Fines owed</th>
                <th className="px-4 py-2 font-medium">Standing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {MEMBERS.map((member) => {
                const eligibility = evaluateEligibility(member);

                return (
                  <tr
                    className="hover:bg-slate-50"
                    data-testid="member-directory-row"
                    key={member.memberId}
                  >
                    <td className="px-4 py-2 text-slate-900" data-testid="member-directory-id">
                      {member.memberId}
                    </td>
                    <td className="px-4 py-2 text-slate-900" data-testid="member-directory-name">
                      {member.name}
                    </td>
                    <td className="px-4 py-2 text-slate-700">{member.activeLoans}</td>
                    <td className="px-4 py-2 text-slate-700">${member.finesOwed.toFixed(2)}</td>
                    <td className="px-4 py-2">
                      <span
                        className={
                          eligibility.eligible ? STANDING_BADGE.eligible : STANDING_BADGE.blocked
                        }
                        data-testid="member-directory-standing"
                      >
                        {eligibility.eligible ? (
                          <CheckCircle2 aria-hidden="true" className="h-3 w-3" />
                        ) : (
                          <AlertTriangle aria-hidden="true" className="h-3 w-3" />
                        )}
                        {eligibility.eligible
                          ? 'Eligible'
                          : describeEligibilityReason(eligibility.reason)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <h2 className="mt-10 font-serif text-lg font-semibold text-slate-900">Look up a member</h2>
        <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-slate-900" htmlFor="member-id">
              Member ID
            </label>
            <input
              autoComplete="off"
              className="w-64 rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
              data-testid="member-id-input"
              id="member-id"
              name="memberId"
              onChange={(event) => setMemberId(event.target.value)}
              type="text"
              value={memberId}
            />
          </div>

          <button
            className="flex items-center gap-1.5 rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            data-testid="member-lookup-button"
            type="submit"
          >
            <Search aria-hidden="true" className="h-4 w-4" />
            Look up
          </button>
        </form>

        {lookup.status === 'found' &&
          (() => {
            const eligibility = evaluateEligibility(lookup.member);

            return (
              <section
                aria-live="polite"
                className="mt-8 rounded border border-slate-200 p-4 shadow-sm"
                data-testid="member-result"
                role="status"
              >
                <h2 className="font-serif text-lg font-semibold text-slate-900">Member standing</h2>

                <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
                  <dt className="font-medium text-slate-600">Name</dt>
                  <dd className="text-slate-900" data-testid="member-name">
                    {lookup.member.name}
                  </dd>

                  <dt className="font-medium text-slate-600">Active loans</dt>
                  <dd className="text-slate-900" data-testid="member-active-loans">
                    {lookup.member.activeLoans}
                  </dd>

                  <dt className="font-medium text-slate-600">Fines owed</dt>
                  <dd className="text-slate-900" data-testid="member-fines-owed">
                    ${lookup.member.finesOwed.toFixed(2)}
                  </dd>
                </dl>

                <p
                  className={
                    eligibility.eligible
                      ? 'mt-4 rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900'
                      : 'mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-slate-900'
                  }
                  data-testid="member-eligibility"
                >
                  {eligibility.eligible
                    ? 'Eligible to borrow.'
                    : `Not eligible to borrow — ${describeEligibilityReason(eligibility.reason)}`}
                </p>
              </section>
            );
          })()}

        {lookup.status === 'not_found' && (
          <section
            aria-live="polite"
            className="mt-8 rounded border border-amber-300 bg-amber-50 p-4"
            data-testid="member-not-found"
            role="status"
          >
            <h2 className="text-lg font-semibold text-slate-900">No matching member</h2>
            <p className="mt-1 text-sm text-slate-700">
              No member was found for {lookup.memberId}.
            </p>
          </section>
        )}
      </div>
    </Layout>
  );
}
