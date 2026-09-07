import { BookOpen, Calendar, LayoutGrid, MapPin, Menu, Users, X } from 'lucide-react';
import { useState } from 'react';

export type NavKey = 'home' | 'catalog' | 'circulation' | 'hours' | 'events';

const NAV_ITEMS: ReadonlyArray<{
  readonly key: NavKey;
  readonly label: string;
  readonly href: string;
  readonly testId: string;
  readonly icon: typeof LayoutGrid;
}> = [
  {
    key: 'catalog',
    label: 'Catalog',
    href: '/catalog',
    testId: 'site-nav-catalog',
    icon: LayoutGrid,
  },
  {
    key: 'circulation',
    label: 'Circulation Desk',
    href: '/circulation',
    testId: 'site-nav-circulation',
    icon: Users,
  },
  {
    key: 'hours',
    label: 'Hours & Locations',
    href: '/hours',
    testId: 'site-nav-hours',
    icon: MapPin,
  },
  { key: 'events', label: 'Events', href: '/events', testId: 'site-nav-events', icon: Calendar },
];

interface SiteHeaderProps {
  readonly current?: NavKey | undefined;
}

/**
 * The site-wide header, present on every page.
 *
 * There is no client-side router (see App.tsx), so these are plain anchors
 * and every navigation is a full page load — deterministic, and consistent
 * with how the rest of the portal is deliberately kept dependency-free. The
 * "Home" link lives in the wordmark rather than the nav list, matching how
 * most civic sites treat their name as the way back.
 */
export function SiteHeader({ current }: SiteHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-10 bg-slate-900 text-white shadow-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-8 py-4">
        <a className="flex items-center gap-2.5" data-testid="site-nav-home" href="/">
          <BookOpen aria-hidden="true" className="h-6 w-6 text-indigo-400" strokeWidth={2} />
          <span className="flex flex-col">
            <span className="font-serif text-lg font-semibold leading-tight tracking-tight">
              Fairview Township Public Library
            </span>
            <span className="text-xs text-slate-400">Serving Fairview Township since 1962</span>
          </span>
        </a>

        <nav aria-label="Primary" className="hidden gap-x-6 text-sm md:flex">
          {NAV_ITEMS.map((item) => {
            const isActive = item.key === current;
            const Icon = item.icon;

            return (
              <a
                aria-current={isActive ? 'page' : undefined}
                className={
                  isActive
                    ? 'flex items-center gap-1.5 font-semibold text-white underline decoration-indigo-400 decoration-2 underline-offset-4'
                    : 'flex items-center gap-1.5 text-slate-300 hover:text-white'
                }
                data-testid={item.testId}
                href={item.href}
                key={item.key}
              >
                <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
                {item.label}
              </a>
            );
          })}
        </nav>

        <button
          aria-expanded={menuOpen}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          className="rounded p-1.5 text-slate-200 hover:bg-slate-800 md:hidden"
          data-testid="site-nav-menu-toggle"
          onClick={() => setMenuOpen((open) => !open)}
          type="button"
        >
          {menuOpen ? (
            <X aria-hidden="true" className="h-6 w-6" />
          ) : (
            <Menu aria-hidden="true" className="h-6 w-6" />
          )}
        </button>
      </div>

      {menuOpen && (
        <nav
          aria-label="Primary"
          className="flex flex-col gap-1 border-t border-slate-800 px-8 py-3 text-sm md:hidden"
          data-testid="site-nav-mobile-menu"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = item.key === current;
            const Icon = item.icon;

            return (
              <a
                aria-current={isActive ? 'page' : undefined}
                className={
                  isActive
                    ? 'flex items-center gap-2 rounded px-2 py-2 font-semibold text-white'
                    : 'flex items-center gap-2 rounded px-2 py-2 text-slate-300 hover:bg-slate-800 hover:text-white'
                }
                data-testid={`${item.testId}-mobile`}
                href={item.href}
                key={item.key}
              >
                <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
                {item.label}
              </a>
            );
          })}
        </nav>
      )}
    </header>
  );
}
