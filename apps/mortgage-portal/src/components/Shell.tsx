import type { ReactNode } from 'react';

import { PORTAL_ENVIRONMENT, PORTAL_NAME, PORTAL_SUBTITLE } from '../app/app-info';

const NAV = [
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/underwriting', label: 'Underwriting' },
] as const;

/** Header, environment banner, and footer — the chrome every page sits inside. */
export function Shell({ current, children }: { current?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-100">
      <div className="bg-amber-400/90 px-6 py-1 text-center text-[11px] font-semibold tracking-widest text-amber-950">
        {PORTAL_ENVIRONMENT}
      </div>

      <header className="border-b border-slate-800 bg-slate-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <a className="flex items-center gap-3" href="/pipeline">
            <span className="flex h-8 w-8 items-center justify-center rounded bg-sky-500 text-sm font-bold text-white">
              M
            </span>
            <span>
              <span className="block text-sm font-semibold text-white">{PORTAL_NAME}</span>
              <span className="block text-[11px] tracking-wide text-slate-400">
                {PORTAL_SUBTITLE}
              </span>
            </span>
          </a>

          <nav className="flex items-center gap-1">
            {NAV.map((item) => (
              <a
                className={`rounded px-3 py-1.5 text-sm transition-colors ${
                  current === item.href
                    ? 'bg-slate-800 font-medium text-white'
                    : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                }`}
                href={item.href}
                key={item.href}
              >
                {item.label}
              </a>
            ))}
            <span className="ml-3 flex items-center gap-2 border-l border-slate-700 pl-3 text-xs text-slate-400">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-700 text-[10px] font-semibold text-slate-200">
                RA
              </span>
              R. Alvarez
            </span>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-4 text-xs text-slate-500">
          {PORTAL_NAME} · Underwriting workspace · Figures shown are system-calculated and refreshed
          on file save.
        </div>
      </footer>
    </div>
  );
}
