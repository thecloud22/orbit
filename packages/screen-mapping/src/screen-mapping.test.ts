import { describe, expect, it } from 'vitest';

import { resolveAddress } from './addressing';
import { compareScreen, fingerprintOf } from './fingerprint';
import { inputFields, type Screen, type ScreenField } from './screen';

function field(
  row: number,
  column: number,
  text: string,
  overrides: Partial<ScreenField['attributes']> = {},
): ScreenField {
  return {
    start: { row, column },
    length: Math.max(text.length, 8),
    text,
    attributes: {
      protected: true,
      numeric: false,
      nonDisplay: false,
      intensified: false,
      ...overrides,
    },
  };
}

/** A logon screen of the shape the 3.0 spike drove s3270 against. */
function logonScreen(): Screen {
  return {
    rows: 24,
    columns: 80,
    cursor: { row: 3, column: 18 },
    fields: [
      field(0, 25, 'ORBIT TEST HOST', { intensified: true }),
      field(3, 2, 'USERID   ===>'),
      field(3, 17, '        ', { protected: false }),
      field(5, 2, 'PASSWORD ===>'),
      field(5, 17, '        ', { protected: false, nonDisplay: true }),
      field(8, 2, 'STATUS: READY'),
    ],
  };
}

describe('screen model', () => {
  it('separates the fields a person can type into', () => {
    expect(inputFields(logonScreen()).map((one) => one.start)).toEqual([
      { row: 3, column: 17 },
      { row: 5, column: 17 },
    ]);
  });

  it('marks the password field non-display from the attribute, not the label', () => {
    // The property that makes terminal redaction protocol-derived rather than
    // heuristic: the host says so.
    const password = logonScreen().fields.find(
      (one) => one.start.row === 5 && !one.attributes.protected,
    );
    expect(password?.attributes.nonDisplay).toBe(true);
  });
});

describe('addressing', () => {
  it('resolves a field by the label that precedes it', () => {
    const result = resolveAddress(logonScreen(), {
      strategy: 'field_after_label',
      label: 'USERID',
    });

    // Trailing `===>` is noise, and the target is the input after the caption.
    expect(result.resolved && result.field.start).toEqual({ row: 3, column: 17 });
  });

  it('resolves a field at an exact position', () => {
    const result = resolveAddress(logonScreen(), { strategy: 'field_at', row: 5, column: 17 });
    expect(result.resolved && result.field.attributes.nonDisplay).toBe(true);
  });

  it('reports ambiguity rather than choosing', () => {
    const screen = logonScreen();
    const twice: Screen = {
      ...screen,
      fields: [
        ...screen.fields,
        field(12, 2, 'USERID   ===>'),
        field(12, 17, '  ', { protected: false }),
      ],
    };

    const result = resolveAddress(twice, { strategy: 'field_after_label', label: 'USERID' });
    expect(result).toEqual({ resolved: false, reason: 'ambiguous' });
  });

  it('resolves nothing for a name, which only a binding can turn into a position', () => {
    expect(resolveAddress(logonScreen(), { strategy: 'named_field', name: 'userid' })).toEqual({
      resolved: false,
      reason: 'not_found',
    });
  });
});

describe('fingerprint', () => {
  it('anchors captions and ignores what a person types', () => {
    const before = fingerprintOf(logonScreen());

    const typed = logonScreen();
    const target = typed.fields[2];
    if (target !== undefined) {
      typed.fields[2] = { ...target, text: 'HERC01  ' };
    }

    // Typing into an unprotected field is not drift. If it were, every run
    // would drift on its own input.
    expect(compareScreen(before, fingerprintOf(typed))).toEqual({ matches: true });
  });

  it('catches a reworded caption', () => {
    const before = fingerprintOf(logonScreen());
    const renamed = logonScreen();
    renamed.fields[1] = field(3, 2, 'USER ID  ===>');

    const result = compareScreen(before, fingerprintOf(renamed));
    expect(result.matches).toBe(false);
    expect(result.matches === false && result.mismatches.map((one) => one.field)).toContain(
      'anchor',
    );
  });

  it('catches an input turned into a caption even when the text is identical', () => {
    const before = fingerprintOf(logonScreen());
    const locked = logonScreen();
    const target = locked.fields[2];
    if (target !== undefined) {
      locked.fields[2] = { ...target, attributes: { ...target.attributes, protected: true } };
    }

    const result = compareScreen(before, fingerprintOf(locked));
    expect(result.matches === false && result.mismatches.map((one) => one.field)).toContain(
      'protectionMask',
    );
  });

  it('reports a geometry change alone, without burying it in anchor noise', () => {
    const before = fingerprintOf(logonScreen());
    const bigger = fingerprintOf({ ...logonScreen(), rows: 43 });

    // A 3278-2 binding on a -4 is one fact, not forty. Model pinning is what
    // this makes legible.
    const result = compareScreen(before, bigger);
    expect(result.matches === false && result.mismatches).toEqual([
      { field: 'geometry', expected: '24x80', observed: '43x80' },
    ]);
  });
});
