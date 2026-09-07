import { navLinks, type View } from './navigation';

export interface NavProps {
  readonly current: View;
  readonly onNavigate: (view: View) => void;
}

/**
 * Watchtower's navigation.
 *
 * Real anchors with real `href`s, intercepted for in-page navigation rather
 * than replaced by buttons. That keeps middle-click, copy-link, and open-in-new-tab
 * working — all of which a button silently breaks — while a plain click stays a
 * `pushState` and avoids a full reload.
 */
export function Nav({ current, onNavigate }: NavProps) {
  return (
    <nav data-testid="watchtower-nav">
      <ul className="mx-auto flex max-w-5xl gap-1 px-8">
        {navLinks(current).map((link) => (
          <li key={link.label}>
            <a
              aria-current={link.current ? 'page' : undefined}
              className={
                link.current
                  ? 'inline-block border-b-2 border-indigo-600 px-3 py-3 text-sm font-medium text-indigo-700 transition-colors'
                  : 'inline-block border-b-2 border-transparent px-3 py-3 text-sm text-slate-600 transition-colors hover:text-indigo-600'
              }
              data-testid={`nav-${link.label.toLowerCase()}`}
              href={link.href}
              onClick={(event) => {
                // Modified clicks belong to the browser: a reader asking for a
                // new tab should get one.
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
                  return;
                }

                event.preventDefault();
                onNavigate(link.view);
              }}
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
