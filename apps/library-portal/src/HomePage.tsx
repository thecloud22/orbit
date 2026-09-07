import { useState, type FormEvent } from 'react';

import { Layout } from './components/Layout';

const QUICK_LINKS: ReadonlyArray<{
  readonly href: string;
  readonly testId: string;
  readonly title: string;
  readonly description: string;
}> = [
  {
    href: '/catalog',
    testId: 'home-link-catalog',
    title: 'Search the Catalog',
    description: 'Find a title by name or ISBN and check its availability.',
  },
  {
    href: '/circulation',
    testId: 'home-link-circulation',
    title: 'Circulation Desk',
    description: 'Staff lookup: a member’s standing and borrowing eligibility.',
  },
  {
    href: '/hours',
    testId: 'home-link-hours',
    title: 'Hours & Locations',
    description: 'Addresses, phone numbers, and open hours for all three branches.',
  },
  {
    href: '/events',
    testId: 'home-link-events',
    title: 'Events',
    description: 'Storytimes, book clubs, and drop-in help sessions.',
  },
];

const ANNOUNCEMENTS: ReadonlyArray<{ readonly title: string; readonly body: string }> = [
  {
    title: 'Closed for Labor Day',
    body: 'All three branches are closed on Labor Day. Regular hours resume the next day.',
  },
  {
    title: 'New self-checkout kiosks at Main Branch',
    body: 'Self-checkout is now available at the Main Branch circulation desk.',
  },
  {
    title: 'Summer reading program sign-up',
    body: 'Registration for the summer reading program is open at any branch, all ages welcome.',
  },
];

export function HomePage() {
  const [heroQuery, setHeroQuery] = useState('');

  function handleHeroSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = heroQuery.trim();
    window.location.href =
      trimmed.length > 0 ? `/catalog?q=${encodeURIComponent(trimmed)}` : '/catalog';
  }

  return (
    <Layout current="home">
      <section className="bg-gradient-to-br from-indigo-50 via-slate-50 to-teal-50">
        <div className="mx-auto max-w-5xl px-8 py-16">
          <h1 className="text-3xl font-semibold text-slate-900">
            Fairview Township Public Library
          </h1>
          <p className="mt-3 max-w-xl text-slate-600">
            Three branches, one catalog. Search our collection, check a title&apos;s availability,
            or find out when we&apos;re open.
          </p>

          <form
            className="mt-8 flex max-w-lg flex-wrap items-end gap-3"
            onSubmit={handleHeroSearch}
          >
            <div className="flex flex-1 flex-col gap-1">
              <label className="text-sm font-medium text-slate-900" htmlFor="home-search">
                Search the catalog
              </label>
              <input
                autoComplete="off"
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
                data-testid="home-search-input"
                id="home-search"
                onChange={(event) => setHeroQuery(event.target.value)}
                placeholder="Title or ISBN"
                type="text"
                value={heroQuery}
              />
            </div>

            <button
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              data-testid="home-search-button"
              type="submit"
            >
              Search
            </button>
          </form>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-8 py-12">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {QUICK_LINKS.map((link) => (
            <a
              className="rounded border border-slate-200 p-5 transition hover:border-indigo-400 hover:shadow-sm"
              data-testid={link.testId}
              href={link.href}
              key={link.href}
            >
              <p className="font-semibold text-slate-900">{link.title}</p>
              <p className="mt-1 text-sm text-slate-600">{link.description}</p>
            </a>
          ))}
        </div>
      </section>

      <section className="border-t border-slate-200">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-10 px-8 py-12 sm:grid-cols-[2fr_1fr]">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Announcements</h2>
            <ul className="mt-4 space-y-4" data-testid="home-announcements">
              {ANNOUNCEMENTS.map((item) => (
                <li className="border-l-2 border-slate-300 pl-4" key={item.title}>
                  <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                  <p className="mt-0.5 text-sm text-slate-600">{item.body}</p>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-slate-900">Library at a glance</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-slate-600">Branches</dt>
                <dd className="text-xl font-semibold text-slate-900">3</dd>
              </div>
              <div>
                <dt className="text-slate-600">Titles in the collection</dt>
                <dd className="text-xl font-semibold text-slate-900">42,000+</dd>
              </div>
              <div>
                <dt className="text-slate-600">Member households</dt>
                <dd className="text-xl font-semibold text-slate-900">12,500+</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>
    </Layout>
  );
}
