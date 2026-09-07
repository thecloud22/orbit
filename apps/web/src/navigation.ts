/**
 * Where Watchtower is, derived from the URL.
 *
 * There is no router, and this is not a stopgap: Phase 1 established that a run
 * is reopened with `?runId=`, sub-phase 2.3 followed it with `?documentId=`,
 * and adding a routing library to formalise the views would be a dependency
 * bought with nothing. What was missing was not routes but *navigation* — every
 * view already had a URL; nothing linked them.
 *
 * The URL is the single source of truth for which view is showing. State
 * derived from it rather than kept alongside it is what makes a link, a
 * bookmark, a reload and the back button all agree.
 */

export type View =
  /** Creating a workflow — Guided path via AI, or Record your own. */
  | { readonly kind: 'home' }
  /** Triggering a published agent. `agentVersionId` highlights one, e.g. one just published. */
  | { readonly kind: 'agents'; readonly agentVersionId?: string }
  /** Every run, across every agent, newest first. */
  | { readonly kind: 'runs' }
  /** One run's status, timeline and evidence, reopened by id. */
  | { readonly kind: 'run'; readonly runId: string }
  | { readonly kind: 'documents' }
  /**
   * One workflow's review page. `bindingSessionId` is present while a browser
   * is open for it, so a reload reattaches to that session rather than
   * orphaning the window it opened.
   */
  | { readonly kind: 'review'; readonly documentId: string; readonly bindingSessionId?: string }
  | { readonly kind: 'recording'; readonly sessionId: string };

export const DOCUMENTS_VIEW = 'documents';
export const AGENTS_VIEW = 'agents';
export const RUNS_VIEW = 'runs';

/**
 * Reads the view out of a URL's query string.
 *
 * `documentId` wins over everything so that an existing review link keeps
 * working unchanged — those were shared before this navigation existed, and a
 * link that stops resolving is worse than a redundant parameter. `runId` is
 * checked next for the same reason: Phase 1 shared bare `?runId=` links before
 * this file existed at all.
 */
export function viewFromSearch(search: string): View {
  const params = new URLSearchParams(search);

  const documentId = params.get('documentId');
  if (documentId !== null && documentId !== '') {
    const bindingSessionId = params.get('bindingSessionId');

    return bindingSessionId === null || bindingSessionId === ''
      ? { kind: 'review', documentId }
      : { kind: 'review', documentId, bindingSessionId };
  }

  const runId = params.get('runId');
  if (runId !== null && runId !== '') {
    return { kind: 'run', runId };
  }

  const sessionId = params.get('recordingSessionId');
  if (sessionId !== null && sessionId !== '') {
    return { kind: 'recording', sessionId };
  }

  const view = params.get('view');

  if (view === DOCUMENTS_VIEW) {
    return { kind: 'documents' };
  }

  if (view === RUNS_VIEW) {
    return { kind: 'runs' };
  }

  if (view === AGENTS_VIEW) {
    const agentVersionId = params.get('agentVersionId');
    return agentVersionId === null || agentVersionId === ''
      ? { kind: 'agents' }
      : { kind: 'agents', agentVersionId };
  }

  return { kind: 'home' };
}

/** The URL a view lives at, relative to the current page. */
export function searchForView(view: View): string {
  switch (view.kind) {
    case 'home':
      return '';
    case 'agents':
      return view.agentVersionId === undefined
        ? `?view=${AGENTS_VIEW}`
        : `?view=${AGENTS_VIEW}&agentVersionId=${encodeURIComponent(view.agentVersionId)}`;
    case 'runs':
      return `?view=${RUNS_VIEW}`;
    case 'run':
      return `?runId=${encodeURIComponent(view.runId)}`;
    case 'documents':
      return `?view=${DOCUMENTS_VIEW}`;
    case 'review':
      return view.bindingSessionId === undefined
        ? `?documentId=${encodeURIComponent(view.documentId)}`
        : `?documentId=${encodeURIComponent(view.documentId)}&bindingSessionId=${encodeURIComponent(
            view.bindingSessionId,
          )}`;
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

const NAV_ITEMS = [
  { kind: 'home', label: 'Home' },
  { kind: 'agents', label: 'Agents' },
  { kind: 'runs', label: 'Runs' },
  // "Workflows", not "Documents": the page itself has always called this list
  // Workflows, and the nav label disagreeing with the page it opens is exactly
  // the kind of small inconsistency that reads as unpolished.
  { kind: 'documents', label: 'Workflows' },
] as const;

/**
 * The navigation bar's links, and which one is current.
 *
 * A drill-down page marks its parent tab current rather than nothing: reading
 * one run or one document should still show where that sits in the app. A
 * recording starts from Home and is not a place in the app of its own.
 */
export function navLinks(current: View): readonly NavLink[] {
  const isCurrent = (kind: (typeof NAV_ITEMS)[number]['kind']): boolean =>
    kind === current.kind ||
    (kind === 'documents' && current.kind === 'review') ||
    (kind === 'runs' && current.kind === 'run') ||
    (kind === 'home' && current.kind === 'recording');

  return NAV_ITEMS.map(({ kind, label }) => {
    // Every tab's own view is just its bare kind — none of the four carries a
    // parameter a nav link would need to supply.
    const view = { kind } as View;

    return {
      label,
      view,
      href: searchForView(view) === '' ? '/' : searchForView(view),
      current: isCurrent(kind),
    };
  });
}
