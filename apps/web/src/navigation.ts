/**
 * Where Watchtower is, derived from the URL.
 *
 * There is no router, and this is not a stopgap: Phase 1 established that a run
 * is reopened with `?runId=`, sub-phase 2.3 followed it with `?documentId=`,
 * and adding a routing library to formalise three views would be a dependency
 * bought with nothing. What was missing was not routes but *navigation* — every
 * view already had a URL; nothing linked them.
 *
 * The URL is the single source of truth for which view is showing. State
 * derived from it rather than kept alongside it is what makes a link, a
 * bookmark, a reload and the back button all agree.
 */

export type View =
  | { readonly kind: 'home' }
  | { readonly kind: 'documents' }
  | { readonly kind: 'review'; readonly documentId: string };

export const DOCUMENTS_VIEW = 'documents';

/**
 * Reads the view out of a URL's query string.
 *
 * `documentId` wins over `view` so that an existing review link keeps working
 * unchanged — those were shared before this navigation existed, and a link that
 * stops resolving is worse than a redundant parameter.
 */
export function viewFromSearch(search: string): View {
  const params = new URLSearchParams(search);
  const documentId = params.get('documentId');

  if (documentId !== null && documentId !== '') {
    return { kind: 'review', documentId };
  }

  return params.get('view') === DOCUMENTS_VIEW ? { kind: 'documents' } : { kind: 'home' };
}

/** The URL a view lives at, relative to the current page. */
export function searchForView(view: View): string {
  switch (view.kind) {
    case 'home':
      return '';
    case 'documents':
      return `?view=${DOCUMENTS_VIEW}`;
    case 'review':
      return `?documentId=${encodeURIComponent(view.documentId)}`;
  }
}

export interface NavLink {
  readonly label: string;
  readonly view: View;
  readonly href: string;
  readonly current: boolean;
}

/**
 * The navigation bar's links, and which one is current.
 *
 * A review page is reached *from* Documents, so it marks Documents current
 * rather than nothing: a reader who has drilled into one document should still
 * see where they are in the app.
 */
export function navLinks(current: View): readonly NavLink[] {
  const isCurrent = (view: View): boolean =>
    view.kind === current.kind || (view.kind === 'documents' && current.kind === 'review');

  return (['home', 'documents'] as const).map((kind) => {
    const view: View = kind === 'home' ? { kind: 'home' } : { kind: 'documents' };

    return {
      label: kind === 'home' ? 'Home' : 'Documents',
      view,
      href: searchForView(view) === '' ? '/' : searchForView(view),
      current: isCurrent(view),
    };
  });
}
