import type { ReactNode } from 'react';

import { SiteHeader, type NavKey } from './SiteHeader';
import { SiteFooter } from './SiteFooter';

interface LayoutProps {
  readonly current?: NavKey | undefined;
  readonly children: ReactNode;
}

/** Shared page chrome: header and footer on every route, content in between. */
export function Layout({ current, children }: LayoutProps) {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <SiteHeader current={current} />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
