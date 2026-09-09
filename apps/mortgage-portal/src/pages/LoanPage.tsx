import { useState } from 'react';

import { Shell } from '../components/Shell';
import {
  CONFORMING_LIMIT,
  debtToIncome,
  EDUCATION_LABELS,
  EMPLOYMENT_LABELS,
  findLoan,
  loanToValue,
  OCCUPANCY_LABELS,
  PROGRAM_LABELS,
  PROPERTY_LABELS,
  type Loan,
} from '../data/loans';

/**
 * One loan file, as an underwriter sees it.
 *
 * Every figure a rule could be written against is on this screen as its own
 * labelled element, already computed. That is not a convenience for the
 * automation -- it is how a loan origination system actually works, and it is
 * the reason a workflow can act on "LTV over 80" without Orbit ever performing
 * arithmetic of its own.
 */
export function LoanPage() {
  const params = new URLSearchParams(window.location.search);
  const loan = findLoan(params.get('loan') ?? '');

  if (loan === undefined) {
    return (
      <Shell current="/underwriting">
        <div className="mx-auto max-w-2xl px-6 py-16">
          <h1 className="text-xl font-semibold text-slate-900">File not found</h1>
          <p className="mt-2 text-sm text-slate-600" data-testid="loan-not-found">
            No file matches that loan number.{' '}
            <a className="text-sky-700 underline" href="/pipeline">
              Back to the pipeline
            </a>
          </p>
        </div>
      </Shell>
    );
  }

  return <LoanFile loan={loan} />;
}

type Decision = 'approved' | 'conditionally_approved' | 'referred_to_senior' | 'declined';

const DECISION_LABELS: Readonly<Record<Decision, string>> = {
  approved: 'Approved',
  conditionally_approved: 'Conditionally approved',
  referred_to_senior: 'Referred to senior underwriter',
  declined: 'Declined',
};

const DECISION_TONES: Readonly<Record<Decision, string>> = {
  approved: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  conditionally_approved: 'border-sky-300 bg-sky-50 text-sky-900',
  referred_to_senior: 'border-amber-300 bg-amber-50 text-amber-900',
  declined: 'border-rose-300 bg-rose-50 text-rose-900',
};

/**
 * The conditions an underwriter can attach, and what each one is called on the
 * commitment letter. Buttons rather than a free-text box, because a condition
 * is a controlled item on a real file -- investors reject a loan whose
 * conditions do not match their own list.
 */
const CONDITIONS = [
  {
    id: 'pmi',
    testId: 'add-pmi-condition',
    label: 'Require private mortgage insurance',
    summary: 'Private mortgage insurance required prior to closing',
  },
  {
    id: 'flood',
    testId: 'add-flood-condition',
    label: 'Require flood insurance',
    summary: 'Flood insurance policy required prior to closing',
  },
  {
    id: 'tax_returns',
    testId: 'add-tax-returns-condition',
    label: 'Require two years of tax returns',
    summary: 'Two years of signed personal and business returns required',
  },
  {
    id: 'reserves',
    testId: 'add-reserves-condition',
    label: 'Require additional reserves',
    summary: 'Six months of additional verified reserves required',
  },
] as const;

function LoanFile({ loan }: { loan: Loan }) {
  const [conditions, setConditions] = useState<readonly string[]>([]);
  const [decision, setDecision] = useState<Decision | null>(null);

  const ltv = loanToValue(loan);
  const dti = debtToIncome(loan);

  function addCondition(id: string) {
    setConditions((current) => (current.includes(id) ? current : [...current, id]));
  }

  return (
    <Shell current="/underwriting">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <a className="text-xs text-sky-700 hover:underline" href="/pipeline">
          ← Pipeline
        </a>

        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1
              className="font-mono text-2xl font-semibold text-slate-900"
              data-testid="loan-number"
            >
              {loan.loanNumber}
            </h1>
            <p className="mt-0.5 text-sm text-slate-600">
              <span data-testid="borrower-name">{loan.borrowerName}</span>
              {loan.coBorrowerName !== null && (
                <>
                  {' & '}
                  <span data-testid="co-borrower-name">{loan.coBorrowerName}</span>
                </>
              )}
              {' · '}
              {loan.propertyAddress}, {loan.propertyCity} {loan.propertyState}
            </p>
          </div>
          <div className="text-right text-xs text-slate-500">
            <div>
              Submitted <span className="font-mono">{loan.submittedOn}</span>
            </div>
            <div>
              Underwriter <span className="font-medium text-slate-700">{loan.underwriter}</span>
            </div>
          </div>
        </div>

        {decision !== null && (
          <div
            className={`mt-5 rounded-lg border px-4 py-3 ${DECISION_TONES[decision]}`}
            data-testid="decision-banner"
          >
            <div className="text-xs font-semibold tracking-wide uppercase opacity-70">
              File decision
            </div>
            <div className="mt-0.5 text-lg font-semibold" data-testid="decision-status">
              {DECISION_LABELS[decision]}
            </div>
          </div>
        )}

        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          <section className="lg:col-span-2">
            <Panel title="Underwriting summary" testId="underwriting-summary">
              <div className="grid grid-cols-2 gap-x-6 gap-y-0 sm:grid-cols-3">
                <Figure
                  label="Loan-to-value"
                  testId="ltv-value"
                  value={`${ltv.toFixed(2)}%`}
                  emphasis={ltv > 80}
                />
                <Figure
                  label="Debt-to-income"
                  testId="dti-value"
                  value={`${dti.toFixed(2)}%`}
                  emphasis={dti > 43}
                />
                <Figure
                  label="Credit score"
                  testId="credit-score-value"
                  value={String(loan.creditScore)}
                  emphasis={loan.creditScore < 620}
                />
                <Figure
                  label="Loan amount"
                  testId="loan-amount-value"
                  value={`$${loan.loanAmount.toLocaleString('en-US')}`}
                />
                <Figure
                  label="Appraised value"
                  testId="appraised-value"
                  value={`$${loan.appraisedValue.toLocaleString('en-US')}`}
                />
                <Figure
                  label="Purchase price"
                  testId="purchase-price-value"
                  value={`$${loan.purchasePrice.toLocaleString('en-US')}`}
                />
                <Figure
                  label="Reserves (months)"
                  testId="reserve-months-value"
                  value={String(loan.reserveMonths)}
                />
                <Figure label="Note rate" testId="note-rate-value" value={`${loan.noteRate}%`} />
                <Figure
                  label="Conforming limit"
                  testId="conforming-limit-value"
                  value={`$${CONFORMING_LIMIT.toLocaleString('en-US')}`}
                />
              </div>
            </Panel>

            <div className="mt-5">
              <Panel title="Borrower & employment" testId="borrower-panel">
                <div className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
                  <Field
                    label="Employment type"
                    testId="employment-type-value"
                    value={EMPLOYMENT_LABELS[loan.employmentType]}
                  />
                  <Field
                    label="Years in role"
                    testId="years-in-role-value"
                    value={String(loan.yearsInRole)}
                  />
                  <Field
                    label="First-time buyer"
                    testId="first-time-buyer-value"
                    value={loan.firstTimeBuyer ? 'Yes' : 'No'}
                  />
                  <Field
                    label="Homebuyer education"
                    testId="homebuyer-education-value"
                    value={EDUCATION_LABELS[loan.homebuyerEducation]}
                  />
                  <Field
                    label="Monthly income"
                    testId="monthly-income-value"
                    value={`$${loan.monthlyIncome.toLocaleString('en-US')}`}
                  />
                  <Field
                    label="Monthly debt"
                    testId="monthly-debt-value"
                    value={`$${loan.monthlyDebt.toLocaleString('en-US')}`}
                  />
                </div>
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    Income analyst note
                  </div>
                  <p
                    className="mt-1 text-sm leading-relaxed text-slate-700"
                    data-testid="employment-note"
                  >
                    {loan.employmentNote}
                  </p>
                </div>
              </Panel>
            </div>

            <div className="mt-5">
              <Panel title="Property & program" testId="property-panel">
                <div className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
                  <Field
                    label="Property type"
                    testId="property-type-value"
                    value={PROPERTY_LABELS[loan.propertyType]}
                  />
                  <Field
                    label="Occupancy"
                    testId="occupancy-value"
                    value={OCCUPANCY_LABELS[loan.occupancy]}
                  />
                  <Field
                    label="Loan program"
                    testId="program-value"
                    value={PROGRAM_LABELS[loan.program]}
                  />
                  <Field
                    label="FEMA flood zone"
                    testId="flood-zone-value"
                    value={loan.floodZone}
                    emphasis={loan.floodZone !== 'X'}
                  />
                  <Field
                    label="Property state"
                    testId="property-state-value"
                    value={loan.propertyState}
                  />
                  <Field
                    label="Property city"
                    testId="property-city-value"
                    value={loan.propertyCity}
                  />
                </div>
              </Panel>
            </div>
          </section>

          <section>
            <Panel title="Conditions" testId="conditions-panel">
              {conditions.length === 0 ? (
                <p className="text-sm text-slate-500" data-testid="conditions-empty">
                  No conditions attached to this file.
                </p>
              ) : (
                <ul className="space-y-2" data-testid="conditions-list">
                  {conditions.map((id) => {
                    const condition = CONDITIONS.find((one) => one.id === id);
                    return (
                      <li
                        className="rounded border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900"
                        data-testid={`condition-${id}`}
                        key={id}
                      >
                        {condition?.summary ?? id}
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  Attach a condition
                </div>
                {CONDITIONS.map((condition) => (
                  <button
                    className="w-full rounded border border-slate-300 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:border-sky-400 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40"
                    data-testid={condition.testId}
                    disabled={conditions.includes(condition.id)}
                    key={condition.id}
                    onClick={() => addCondition(condition.id)}
                    type="button"
                  >
                    {condition.label}
                  </button>
                ))}
              </div>
            </Panel>

            <div className="mt-5">
              <Panel title="File decision" testId="decision-panel">
                <div className="space-y-2">
                  <button
                    className="w-full rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
                    data-testid="approve-button"
                    onClick={() =>
                      setDecision(conditions.length > 0 ? 'conditionally_approved' : 'approved')
                    }
                    type="button"
                  >
                    Approve file
                  </button>
                  <button
                    className="w-full rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-100"
                    data-testid="escalate-button"
                    onClick={() => setDecision('referred_to_senior')}
                    type="button"
                  >
                    Refer to senior underwriter
                  </button>
                  <button
                    className="w-full rounded border border-rose-400 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-900 transition-colors hover:bg-rose-100"
                    data-testid="decline-button"
                    onClick={() => setDecision('declined')}
                    type="button"
                  >
                    Decline file
                  </button>
                </div>
              </Panel>
            </div>
          </section>
        </div>
      </div>
    </Shell>
  );
}

function Panel({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm" data-testid={testId}>
      <div className="border-b border-slate-100 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      </div>
      <div className="px-4 py-4">{children}</div>
    </div>
  );
}

/** A headline number: big, monospace, and flagged when it is past a threshold. */
function Figure({
  label,
  testId,
  value,
  emphasis = false,
}: {
  label: string;
  testId: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="border-b border-slate-100 py-3 last:border-b-0">
      <div className="text-xs tracking-wide text-slate-500 uppercase">{label}</div>
      <div
        className={`mt-0.5 font-mono text-lg ${emphasis ? 'font-semibold text-amber-700' : 'text-slate-900'}`}
        data-testid={testId}
      >
        {value}
      </div>
    </div>
  );
}

function Field({
  label,
  testId,
  value,
  emphasis = false,
}: {
  label: string;
  testId: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="border-b border-slate-100 py-2.5 last:border-b-0">
      <div className="text-xs tracking-wide text-slate-500 uppercase">{label}</div>
      <div
        className={`mt-0.5 text-sm ${emphasis ? 'font-semibold text-amber-700' : 'text-slate-900'}`}
        data-testid={testId}
      >
        {value}
      </div>
    </div>
  );
}
