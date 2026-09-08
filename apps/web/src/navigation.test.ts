import { describe, expect, it } from 'vitest';

import { navLinks, searchForView, viewFromSearch, type View } from './navigation';

describe('viewFromSearch', () => {
  it('defaults to home', () => {
    expect(viewFromSearch('')).toEqual({ kind: 'home' });
    expect(viewFromSearch('?')).toEqual({ kind: 'home' });
  });

  it('reads the documents view', () => {
    expect(viewFromSearch('?view=documents')).toEqual({ kind: 'documents' });
  });

  it('reads the agents view', () => {
    expect(viewFromSearch('?view=agents')).toEqual({ kind: 'agents' });
  });

  it('reads the runs view', () => {
    expect(viewFromSearch('?view=runs')).toEqual({ kind: 'runs' });
  });

  it('reads a review view from its document id', () => {
    expect(viewFromSearch('?documentId=sopdoc_123')).toEqual({
      kind: 'review',
      documentId: 'sopdoc_123',
    });
  });

  it('keeps an existing review link working even alongside a view parameter', () => {
    // Review links were shared before this navigation existed. A link that
    // stops resolving is worse than a redundant parameter.
    expect(viewFromSearch('?view=documents&documentId=sopdoc_123')).toEqual({
      kind: 'review',
      documentId: 'sopdoc_123',
    });
  });

  it('reattaches to an open walkthrough from the URL', () => {
    // For the same reason a binding session is in the URL: a reload must find
    // the browser Orbit opened rather than orphan the window.
    expect(viewFromSearch('?documentId=sopdoc_123&walkthroughSessionId=walk_abc')).toEqual({
      kind: 'review',
      documentId: 'sopdoc_123',
      walkthroughSessionId: 'walk_abc',
    });
  });

  it('ignores an empty walkthrough session id rather than polling for nothing', () => {
    expect(viewFromSearch('?documentId=sopdoc_123&walkthroughSessionId=')).toEqual({
      kind: 'review',
      documentId: 'sopdoc_123',
    });
  });

  it('ignores an empty document id rather than showing an empty review', () => {
    expect(viewFromSearch('?documentId=')).toEqual({ kind: 'home' });
  });

  it('ignores a view it does not know', () => {
    expect(viewFromSearch('?view=nonsense')).toEqual({ kind: 'home' });
  });

  it('reads a run by id, a Phase 1 link shared before this navigation existed', () => {
    expect(viewFromSearch('?runId=run_123')).toEqual({ kind: 'run', runId: 'run_123' });
  });

  it('prefers a document link over a run id', () => {
    expect(viewFromSearch('?runId=run_123&documentId=sopdoc_1')).toEqual({
      kind: 'review',
      documentId: 'sopdoc_1',
    });
  });

  it('reads the agent highlighted after a publish', () => {
    expect(viewFromSearch('?view=agents&agentVersionId=agentv_1')).toEqual({
      kind: 'agents',
      agentVersionId: 'agentv_1',
    });
  });

  it('reads a recording session', () => {
    expect(viewFromSearch('?recordingSessionId=rec_abc')).toEqual({
      kind: 'recording',
      sessionId: 'rec_abc',
    });
  });

  it('still prefers an existing review link over a recording', () => {
    expect(viewFromSearch('?recordingSessionId=rec_abc&documentId=sopdoc_1')).toEqual({
      kind: 'review',
      documentId: 'sopdoc_1',
    });
  });
});

describe('searchForView', () => {
  it('round-trips every view', () => {
    const views: readonly View[] = [
      { kind: 'home' },
      { kind: 'agents' },
      { kind: 'agents', agentVersionId: 'agentv_1' },
      { kind: 'runs' },
      { kind: 'run', runId: 'run_123' },
      { kind: 'documents' },
      { kind: 'review', documentId: 'sopdoc_123' },
      { kind: 'review', documentId: 'sopdoc_123', bindingSessionId: 'bind_abc' },
      { kind: 'review', documentId: 'sopdoc_123', walkthroughSessionId: 'walk_abc' },
      { kind: 'recording', sessionId: 'rec_abc' },
    ];

    for (const view of views) {
      expect(viewFromSearch(searchForView(view))).toEqual(view);
    }
  });

  it('encodes a document id rather than trusting it', () => {
    expect(searchForView({ kind: 'review', documentId: 'a b&c' })).toBe('?documentId=a%20b%26c');
  });
});

describe('navLinks', () => {
  it('offers Home, Studio, Agents and Runs, in that order', () => {
    // Authoring sits between arriving and running, because that is the order
    // the work actually moves through them.
    expect(navLinks({ kind: 'home' }).map((link) => link.label)).toEqual([
      'Home',
      'Studio',
      'Agents',
      'Runs',
    ]);
  });

  it('marks exactly one link current', () => {
    for (const view of [
      { kind: 'home' },
      { kind: 'agents' },
      { kind: 'runs' },
      { kind: 'documents' },
    ] as const) {
      expect(navLinks(view).filter((link) => link.current)).toHaveLength(1);
    }
  });

  it('keeps Home current while recording, which is where a recording starts', () => {
    const links = navLinks({ kind: 'recording', sessionId: 'rec_abc' });

    // A recording is something you are doing, not a place in the app.
    expect(links.find((link) => link.label === 'Home')?.current).toBe(true);
    expect(links.find((link) => link.label === 'Studio')?.current).toBe(false);
  });

  it('keeps Studio current while reading a document', () => {
    // A reader who has drilled into one document should still see where they
    // are, rather than the bar going blank.
    const links = navLinks({ kind: 'review', documentId: 'sopdoc_123' });

    expect(links.find((link) => link.label === 'Studio')?.current).toBe(true);
    expect(links.find((link) => link.label === 'Home')?.current).toBe(false);
  });

  it('keeps Runs current while reading one run', () => {
    const links = navLinks({ kind: 'run', runId: 'run_123' });

    expect(links.find((link) => link.label === 'Runs')?.current).toBe(true);
    expect(links.find((link) => link.label === 'Home')?.current).toBe(false);
  });

  it('gives every link a real href, so it can be opened in a new tab', () => {
    for (const link of navLinks({ kind: 'home' })) {
      expect(link.href).not.toBe('');
    }
    expect(navLinks({ kind: 'home' })[0]?.href).toBe('/');
  });

  it('keeps Studio at the URL its shared links already use', () => {
    // The label changed; the address deliberately did not (ADR-031).
    expect(navLinks({ kind: 'home' }).find((link) => link.label === 'Studio')?.href).toBe(
      '?view=documents',
    );
  });
});
