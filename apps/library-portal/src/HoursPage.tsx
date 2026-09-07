import { MapPin, Phone } from 'lucide-react';

import { Layout } from './components/Layout';
import { BRANCHES } from './data/branches';

export function HoursPage() {
  return (
    <Layout current="hours">
      <div className="mx-auto max-w-5xl px-8 py-12">
        <h1 className="font-serif text-2xl font-semibold text-slate-900">Hours & Locations</h1>
        <p className="mt-2 text-sm text-slate-600">
          All three branches are closed on major township holidays.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3" data-testid="hours-branch-list">
          {BRANCHES.map((branch) => (
            <div
              className="rounded border border-slate-200 p-5 shadow-sm transition-shadow hover:shadow-md"
              data-testid="hours-branch-card"
              key={branch.id}
            >
              <h2
                className="font-serif font-semibold text-slate-900"
                data-testid="hours-branch-name"
              >
                {branch.name}
              </h2>

              <p className="mt-3 flex items-start gap-2 text-sm text-slate-600">
                <MapPin aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                {branch.address}
              </p>
              <p className="mt-1 flex items-center gap-2 text-sm text-slate-600">
                <Phone aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400" />
                {branch.phone}
              </p>

              <dl className="mt-4 space-y-1 border-t border-slate-100 pt-3 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-600">Mon–Thu</dt>
                  <dd className="text-slate-900">{branch.hours.weekdays}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-600">Fri</dt>
                  <dd className="text-slate-900">{branch.hours.friday}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-600">Sat</dt>
                  <dd className="text-slate-900">{branch.hours.saturday}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-600">Sun</dt>
                  <dd className="text-slate-900">{branch.hours.sunday}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      </div>
    </Layout>
  );
}
