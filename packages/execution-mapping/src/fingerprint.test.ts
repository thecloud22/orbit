import { describe, expect, it } from 'vitest';

import {
  compareFingerprint,
  parseAriaSnapshotHeader,
  type ElementFingerprint,
} from './fingerprint';

const BUTTON: ElementFingerprint = {
  role: 'button',
  accessibleName: 'Search',
  text: 'Search',
  boundingBox: { x: 604, y: 142, width: 78, height: 36 },
};

const STATUS: ElementFingerprint = {
  role: 'definition',
  accessibleName: null,
  text: 'In Progress',
  boundingBox: { x: 0, y: 0, width: 100, height: 20 },
};

describe('compareFingerprint', () => {
  it('matches an unchanged element', () => {
    expect(compareFingerprint(BUTTON, BUTTON, 'action')).toEqual({ matches: true });
  });

  it('blocks when the role changed', () => {
    const observed = { ...BUTTON, role: 'link' };
    const result = compareFingerprint(BUTTON, observed, 'action');

    expect(result.matches).toBe(false);
    expect(!result.matches && result.mismatches).toEqual([
      { field: 'role', expected: 'button', observed: 'link' },
    ]);
  });

  it('blocks when the accessible name changed', () => {
    const result = compareFingerprint(BUTTON, { ...BUTTON, accessibleName: 'Find' }, 'action');
    expect(!result.matches && result.mismatches.map((m) => m.field)).toEqual(['accessibleName']);
  });

  it('blocks when an action target’s text changed', () => {
    // A button's text is its label. If that changed, the control changed.
    const result = compareFingerprint(BUTTON, { ...BUTTON, text: 'Go' }, 'action');
    expect(!result.matches && result.mismatches.map((m) => m.field)).toEqual(['text']);
  });

  it('does NOT block when a read target’s text changed', () => {
    // The whole point of a read target is that its text is the value being
    // extracted: "In Progress" this run, "Closed" the next. Comparing it would
    // manufacture drift on every extract step in every workflow.
    const observed = { ...STATUS, text: 'Closed' };

    expect(compareFingerprint(STATUS, observed, 'read')).toEqual({ matches: true });
    expect(compareFingerprint(STATUS, observed, 'action').matches).toBe(false);
  });

  it('does not treat a reflow as a change', () => {
    const observed = { ...BUTTON, text: '  Search \n ' };
    expect(compareFingerprint(BUTTON, observed, 'action')).toEqual({ matches: true });
  });

  it('never blocks on position alone', () => {
    // Layout legitimately moves. Blocking on it would be manufacturing drift.
    const moved = { ...BUTTON, boundingBox: { x: 0, y: 900, width: 78, height: 36 } };
    expect(compareFingerprint(BUTTON, moved, 'action')).toEqual({ matches: true });
  });

  it('does not compare a field the recording never captured', () => {
    // Absence at record time is not evidence about run time.
    const expected: ElementFingerprint = { ...BUTTON, accessibleName: null };
    const observed: ElementFingerprint = { ...BUTTON, accessibleName: 'Anything at all' };

    expect(compareFingerprint(expected, observed, 'action')).toEqual({ matches: true });
  });

  it('reports every mismatch at once, not just the first', () => {
    const observed = { ...BUTTON, role: 'link', accessibleName: 'Find', text: 'Find' };
    const result = compareFingerprint(BUTTON, observed, 'action');

    expect(!result.matches && result.mismatches.map((m) => m.field)).toEqual([
      'role',
      'accessibleName',
      'text',
    ]);
  });
});

describe('parseAriaSnapshotHeader', () => {
  // Every sample below was captured from a real Playwright 1.62.1 ariaSnapshot
  // against the demo portal, not invented.
  it('reads a role and accessible name', () => {
    expect(parseAriaSnapshotHeader('- textbox "Service request number"')).toEqual({
      role: 'textbox',
      accessibleName: 'Service request number',
    });
    expect(parseAriaSnapshotHeader('- button "Search"')).toEqual({
      role: 'button',
      accessibleName: 'Search',
    });
  });

  it('does not mistake content after a colon for a name', () => {
    // `In Progress` is the value being read, not what the element is called.
    expect(parseAriaSnapshotHeader('- definition: In Progress')).toEqual({
      role: 'definition',
      accessibleName: null,
    });
  });

  it('reads only the first line, ignoring the subtree', () => {
    const container = [
      '- status:',
      '  - heading "Service request" [level=2]',
      '  - definition: SR-1001',
    ].join('\n');

    // The subtree holds values that change every run; only the target matters.
    expect(parseAriaSnapshotHeader(container)).toEqual({ role: 'status', accessibleName: null });
  });

  it('ignores trailing annotations such as [level=2]', () => {
    expect(parseAriaSnapshotHeader('- heading "Service request" [level=2]')).toEqual({
      role: 'heading',
      accessibleName: 'Service request',
    });
  });

  it('returns nothing rather than guessing when there is no role', () => {
    expect(parseAriaSnapshotHeader('')).toEqual({ role: null, accessibleName: null });
    expect(parseAriaSnapshotHeader('- "just a string"')).toEqual({
      role: null,
      accessibleName: null,
    });
  });

  it('unescapes a quoted name containing a quote', () => {
    expect(parseAriaSnapshotHeader('- button "Say \\"hello\\""')).toEqual({
      role: 'button',
      accessibleName: 'Say "hello"',
    });
  });
});
