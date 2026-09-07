import { describe, expect, it } from 'vitest';

import { BRANCHES } from './branches';

describe('BRANCHES', () => {
  it('seeds three branches', () => {
    expect(BRANCHES).toHaveLength(3);
  });

  it('includes the Main Branch', () => {
    expect(BRANCHES.find((branch) => branch.id === 'main')?.name).toBe('Main Branch');
  });

  it('is frozen so the portal stays read-only', () => {
    expect(Object.isFrozen(BRANCHES)).toBe(true);
    expect(Object.isFrozen(BRANCHES[0])).toBe(true);
    expect(Object.isFrozen(BRANCHES[0]?.hours)).toBe(true);
  });
});
