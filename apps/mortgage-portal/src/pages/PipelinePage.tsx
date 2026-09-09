import { useState } from 'react';

import { Shell } from '../components/Shell';
import {
  debtToIncome,
  findLoan,
  loanToValue,
  LOANS,
  PROGRAM_LABELS,
  STATUS_LABELS,
} from '../data/loans';

/** The queue an underwriter opens a file from, plus the lookup by loan number. */
export function PipelinePage() {
  const [query, setQuery] = useState('');
  const [notFound, setNotFound] = useState(false);

  function openLoan() {
    const loan = findLoan(query);

    if (loan === undefined) {
      setNotFound(true);
      return;
    }

    window.location.href = `/underwriting?loan=${encodeURIComponent(loan.loanNumber)}`;
  }

  return (
    <Shell current="/pipeline">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="text-xl font-semibold text-slate-900">Underwriting pipeline</h1>
        <p className="mt-1 text-sm text-slate-600">
          {LOANS.length} files awaiting a decision. Open a file to review its underwriting summary.
        </p>

        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <label
            className="block text-xs font-semibold tracking-wide text-slate-500 uppercase"
            htmlFor="loan-number-input"
          >
            Open a file by loan number
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              className="w-64 rounded border border-slate-300 px-3 py-2 font-mono text-sm focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:outline-none"
              data-testid="loan-number-input"
              id="loan-number-input"
              onChange={(event) => {
                setQuery(event.target.value);
                setNotFound(false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  openLoan();
                }
              }}
              placeholder="ML-26-04471"
              value={query}
            />
            <button
              className="rounded bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-500"
              data-testid="open-loan-button"
              onClick={openLoan}
              type="button"
            >
              Open file
            </button>
          </div>

          {notFound && (
            <p className="mt-3 text-sm text-rose-700" data-testid="loan-not-found">
              No file matches that loan number.
            </p>
          )}
        </div>

        <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm" data-testid="pipeline-table">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2 font-semibold">Loan number</th>
                <th className="px-4 py-2 font-semibold">Borrower</th>
                <th className="px-4 py-2 font-semibold">Program</th>
                <th className="px-4 py-2 text-right font-semibold">Amount</th>
                <th className="px-4 py-2 text-right font-semibold">LTV</th>
                <th className="px-4 py-2 text-right font-semibold">DTI</th>
                <th className="px-4 py-2 text-right font-semibold">FICO</th>
                <th className="px-4 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {LOANS.map((loan) => (
                <tr className="transition-colors hover:bg-sky-50/60" key={loan.loanNumber}>
                  <td className="px-4 py-2.5">
                    <a
                      className="font-mono text-sky-700 hover:underline"
                      href={`/underwriting?loan=${encodeURIComponent(loan.loanNumber)}`}
                    >
                      {loan.loanNumber}
                    </a>
                  </td>
                  <td className="px-4 py-2.5 text-slate-800">{loan.borrowerName}</td>
                  <td className="px-4 py-2.5 text-slate-600">{PROGRAM_LABELS[loan.program]}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-800">
                    ${loan.loanAmount.toLocaleString('en-US')}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-800">
                    {loanToValue(loan).toFixed(2)}%
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-800">
                    {debtToIncome(loan).toFixed(2)}%
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-800">
                    {loan.creditScore}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                      {STATUS_LABELS[loan.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
