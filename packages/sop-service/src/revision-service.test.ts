import { describe, expect, it } from 'vitest';

import { isValueOnlyFillChange } from './revision-service';

function fillStep(overrides: Record<string, unknown> = {}) {
  return {
    id: 'enter_member_id',
    kind: 'fill' as const,
    purpose: 'Fill in the member id',
    fieldHint: 'Member ID',
    value: 'LIB-1001',
    ...overrides,
  };
}

describe('isValueOnlyFillChange', () => {
  it('is true when only the value differs', () => {
    expect(isValueOnlyFillChange(fillStep(), fillStep({ value: '${inputs.memberId}' }))).toBe(true);
  });

  it('is false when the field being filled also changes', () => {
    // The actual thing a binding names. Carrying forward here would mean the
    // binding no longer describes what the step says it does.
    expect(
      isValueOnlyFillChange(
        fillStep(),
        fillStep({ value: '${inputs.memberId}', fieldHint: 'Account ID' }),
      ),
    ).toBe(false);
  });

  it('is false when the purpose also changes', () => {
    expect(
      isValueOnlyFillChange(fillStep(), fillStep({ value: 'x', purpose: 'Something else' })),
    ).toBe(false);
  });

  it('is false when sensitivity flips', () => {
    // Marking a field secret is a more consequential change than the value
    // itself, and is not the reported problem -- kept out of the safe set
    // deliberately rather than by omission.
    expect(isValueOnlyFillChange(fillStep(), fillStep({ value: 'x', sensitive: true }))).toBe(
      false,
    );
  });

  it('treats sensitive absent and sensitive false as the same', () => {
    expect(isValueOnlyFillChange(fillStep({ sensitive: false }), fillStep({ value: 'x' }))).toBe(
      true,
    );
  });

  it('is false for a step that is not a fill', () => {
    const click = {
      id: 'click_one',
      kind: 'click' as const,
      purpose: 'Click it',
      targetHint: 'Go',
    };
    expect(isValueOnlyFillChange(click, click)).toBe(false);
  });

  it('is false when nothing at all changed but the kind differs between the two', () => {
    const click = { id: 'x', kind: 'click' as const, purpose: 'p', targetHint: 't' };
    const fill = fillStep({ id: 'x', purpose: 'p' });
    expect(isValueOnlyFillChange(click, fill)).toBe(false);
    expect(isValueOnlyFillChange(fill, click)).toBe(false);
  });
});
