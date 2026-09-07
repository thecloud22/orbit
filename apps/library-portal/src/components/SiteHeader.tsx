export type NavKey = 'home' | 'catalog' | 'circulation' | 'hours' | 'events';

const NAV_ITEMS: ReadonlyArray<{
  readonly key: NavKey;
  readonly label: string;
  readonly href: string;
  readonly testId: string;
}> = [
  { key: 'home', label: 'Home', href: '/', testId: 'site-nav-home' },
  { key: 'catalog', label: 'Catalog', href: '/catalog', testId: 'site-nav-catalog' },
  {
    key: 'circulation',
    label: 'Circulation Desk',
    href: '/circulation',
    testId: 'site-nav-circulation',
  },
  { key: 'hours', label: 'Hours & Locations', href: '/hours', testId: 'site-nav-hours' },
  { key: 'events', label: 'Events', href: '/events', testId: 'site-nav-events' },
];

interface SiteHeaderProps {
  readonly current?: NavKey | undefined;
}

/**
 * The site-wide header, present on every page.
 *
 * There is no client-side router (see App.tsx), so these are plain anchors
 * and every navigation is a full page load — deterministic, and consistent
 * with how the rest of the portal is deliberately kept dependency-free.
 */
export function SiteHeader({ current }: SiteHeaderProps) {
  return (
    <header className="bg-slate-900 text-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-8 py-4">
        <a className="flex flex-col" href="/">
          <span className="text-lg font-semibold tracking-tight">
            Fairview Township Public Library
          </span>
          <span className="text-xs text-slate-400">Serving Fairview Township since 1962</span>
        </a>

        <nav aria-label="Primary" className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {NAV_ITEMS.map((item) => {
            const isActive = item.key === current;

            return (
              <a
                aria-current={isActive ? 'page' : undefined}
                className={
                  isActive
                    ? 'font-semibold text-white underline decoration-indigo-400 decoration-2 underline-offset-4'
                    : 'text-slate-300 hover:text-white'
                }
                data-testid={item.testId}
                href={item.href}
                key={item.key}
              >
                {item.label}
              </a>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
