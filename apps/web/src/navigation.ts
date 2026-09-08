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
  /** The landing page: what Orbit is, the two ways in, and what is going on. */
  | { readonly kind: 'home' }
  /** Triggering a published agent. `agentVersionId` highlights one, e.g. one just published. */
  | { readonly kind: 'agents'; readonly agentVersionId?: string }
  /** Every run, across every agent, newest first. */
  | { readonly kind: 'runs' }
  /** One run's status, timeline and evidence, reopened by id. */
  | { readonly kind: 'run'; readonly runId: string }
  /** Studio: everything drafted or recorded, on its way to becoming an agent. */
  | { readonly kind: 'documents' }
  /**
   * One workflow's review page. `bindingSessionId` is present while a browser
   * is open for it, so a reload reattaches to that session rather than
   * orphaning the window it opened.
   */
  | {
      readonly kind: 'review';
      readonly documentId: string;
      readonly bindingSessionId?: string;
      /**
       * The open walkthrough, for the same reason `bindingSessionId` is here: a
       * reload must reattach to the browser Orbit opened rather than orphan it.
       * The two never coexist — starting one closes the other's affordance —
       * but they are separate parameters because they name separate sessions.
       */
      readonly walkthroughSessionId?: string;
    }
  | { readonly kind: 'recording'; readonly sessionId: string }
  /**
   * The in-app handbook: how to record, bind, publish, run, read evidence and
   * answer a recovery proposal. `topic` deep-links to one entry, following the
   * pattern every other view already uses — a place in the app is a URL.
   */
  | { readonly kind: 'wiki'; readonly topic?: string };

export const DOCUMENTS_VIEW = 'documents';
export const AGENTS_VIEW = 'agents';
export const RUNS_VIEW = 'runs';
export const WIKI_VIEW = 'wiki';

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
    const walkthroughSessionId = params.get('walkthroughSessionId');

    return {
      kind: 'review',
      documentId,
      ...(bindingSessionId === null || bindingSessionId === '' ? {} : { bindingSessionId }),
      ...(walkthroughSessionId === null || walkthroughSessionId === ''
        ? {}
        : { walkthroughSessionId }),
    };
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

  if (view === WIKI_VIEW) {
    const topic = params.get('topic');
    return topic === null || topic === '' ? { kind: 'wiki' } : { kind: 'wiki', topic };
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
    case 'review': {
      const parts = [`documentId=${encodeURIComponent(view.documentId)}`];

      if (view.bindingSessionId !== undefined) {
        parts.push(`bindingSessionId=${encodeURIComponent(view.bindingSessionId)}`);
      }

      if (view.walkthroughSessionId !== undefined) {
        parts.push(`walkthroughSessionId=${encodeURIComponent(view.walkthroughSessionId)}`);
      }

      return `?${parts.join('&')}`;
    }
    case 'recording':
      return `?recordingSessionId=${encodeURIComponent(view.sessionId)}`;
    case 'wiki':
      return view.topic === undefined
        ? `?view=${WIKI_VIEW}`
        : `?view=${WIKI_VIEW}&topic=${encodeURIComponent(view.topic)}`;
  }
}

export interface NavLink {
  readonly label: string;
  readonly view: View;
  readonly href: string;
  readonly current: boolean;
}

/**
 * The five places: arrive, author, run, observe — the order the work moves
 * through them — and then the handbook that explains all four.
 *
 * "Studio", not "Workflows". "Agents vs Workflows" gave two names to what a
 * reader experiences as one idea and left neither of them meaning *authoring* —
 * a published agent came from a workflow, so which tab holds the thing you are
 * about to edit was a coin toss. Studio is this product's own word for the
 * authoring surface, opposite Watchtower as the observability one, and it names
 * what the place is for instead of what it happens to list.
 *
 * The URL value stays `documents` (ADR-031). Review links were shared before
 * this navigation existed; renaming a query parameter to agree with a label
 * would break them and buy nothing, since nobody reads `?view=`.
 *
 * Wiki is last because it is not a step in the work. It sits in the same bar
 * rather than behind a help icon because the questions it answers — what a
 * binding is, why a run stopped, what to do with a recovery proposal — arrive
 * while someone is mid-task, and a reader who has to leave the app to find the
 * answer generally does not come back.
 */
const NAV_ITEMS = [
  { kind: 'home', label: 'Home' },
  { kind: 'documents', label: 'Studio' },
  { kind: 'agents', label: 'Agents' },
  { kind: 'runs', label: 'Runs' },
  { kind: 'wiki', label: 'Wiki' },
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
    // Every tab's own view is just its bare kind — none of the five carries a
    // parameter a nav link would need to supply. The wiki's optional `topic`
    // is for a deep link into one entry, never for the tab itself.
    const view = { kind } as View;

    return {
      label,
      view,
      href: searchForView(view) === '' ? '/' : searchForView(view),
      current: isCurrent(kind),
    };
  });
}
