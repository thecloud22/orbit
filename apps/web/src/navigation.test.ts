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

  it('ignores an empty document id rather than showing an empty review', () => {
    expect(viewFromSearch('?documentId=')).toEqual({ kind: 'home' });
  });

  it('ignores a view it does not know', () => {
    expect(viewFromSearch('?view=nonsense')).toEqual({ kind: 'home' });
  });

  it('is unaffected by a run id, which belongs to the home view', () => {
    expect(viewFromSearch('?runId=run_123')).toEqual({ kind: 'home' });
  });

  it('reads the agent highlighted after a publish', () => {
    expect(viewFromSearch('?agentVersionId=agentv_1')).toEqual({
      kind: 'home',
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
      { kind: 'documents' },
      { kind: 'review', documentId: 'sopdoc_123' },
      { kind: 'recording', sessionId: 'rec_abc' },
      { kind: 'home', agentVersionId: 'agentv_1' },
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
  it('offers Home and Documents', () => {
    expect(navLinks({ kind: 'home' }).map((link) => link.label)).toEqual(['Home', 'Workflows']);
  });

  it('marks exactly one link current', () => {
    for (const view of [{ kind: 'home' }, { kind: 'documents' }] as const) {
      expect(navLinks(view).filter((link) => link.current)).toHaveLength(1);
    }
  });

  it('keeps Home current while recording, which is where a recording starts', () => {
    const links = navLinks({ kind: 'recording', sessionId: 'rec_abc' });

    // A recording is something you are doing, not a place in the app.
    expect(links.find((link) => link.label === 'Home')?.current).toBe(true);
    expect(links.find((link) => link.label === 'Workflows')?.current).toBe(false);
  });

  it('keeps Documents current while reading a document', () => {
    // A reader who has drilled into one document should still see where they
    // are, rather than the bar going blank.
    const links = navLinks({ kind: 'review', documentId: 'sopdoc_123' });

    expect(links.find((link) => link.label === 'Workflows')?.current).toBe(true);
    expect(links.find((link) => link.label === 'Home')?.current).toBe(false);
  });

  it('gives every link a real href, so it can be opened in a new tab', () => {
    for (const link of navLinks({ kind: 'home' })) {
      expect(link.href).not.toBe('');
    }
    expect(navLinks({ kind: 'home' })[0]?.href).toBe('/');
  });
});
