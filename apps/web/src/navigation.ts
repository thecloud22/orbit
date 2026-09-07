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
  /** `agentVersionId` highlights one published agent, e.g. the one just published. */
  | { readonly kind: 'home'; readonly agentVersionId?: string }
  | { readonly kind: 'documents' }
  | { readonly kind: 'review'; readonly documentId: string }
  | { readonly kind: 'recording'; readonly sessionId: string };

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

  const sessionId = params.get('recordingSessionId');

  if (sessionId !== null && sessionId !== '') {
    return { kind: 'recording', sessionId };
  }

  if (params.get('view') === DOCUMENTS_VIEW) {
    return { kind: 'documents' };
  }

  const agentVersionId = params.get('agentVersionId');

  return agentVersionId === null || agentVersionId === ''
    ? { kind: 'home' }
    : { kind: 'home', agentVersionId };
}

/** The URL a view lives at, relative to the current page. */
export function searchForView(view: View): string {
  switch (view.kind) {
    case 'home':
      return view.agentVersionId === undefined
        ? ''
        : `?agentVersionId=${encodeURIComponent(view.agentVersionId)}`;
    case 'documents':
      return `?view=${DOCUMENTS_VIEW}`;
    case 'review':
      return `?documentId=${encodeURIComponent(view.documentId)}`;
    case 'recording':
      return `?recordingSessionId=${encodeURIComponent(view.sessionId)}`;
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
    view.kind === current.kind ||
    (view.kind === 'documents' && current.kind === 'review') ||
    // A recording starts on Home and is not a place in the app of its own.
    (view.kind === 'home' && current.kind === 'recording');

  return (['home', 'documents'] as const).map((kind) => {
    const view: View = kind === 'home' ? { kind: 'home' } : { kind: 'documents' };

    return {
      // "Workflows", not "Documents": the page itself has always called this
      // list Workflows, and the nav label disagreeing with the page it opens
      // is exactly the kind of small inconsistency that reads as unpolished.
      label: kind === 'home' ? 'Home' : 'Workflows',
      view,
      href: searchForView(view) === '' ? '/' : searchForView(view),
      current: isCurrent(view),
    };
  });
}
