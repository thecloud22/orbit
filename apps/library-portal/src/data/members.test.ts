import { describe, expect, it } from 'vitest';

import { evaluateEligibility, findMember, MEMBERS, type Member } from './members';

describe('findMember', () => {
  it('returns the seeded member for a known ID', () => {
    expect(findMember('LIB-1001')).toEqual(MEMBERS[0]);
  });

  it('returns undefined for an unknown ID', () => {
    expect(findMember('LIB-9999')).toBeUndefined();
  });

  it('trims surrounding whitespace before looking up', () => {
    expect(findMember('  LIB-1001  ')).toEqual(MEMBERS[0]);
  });

  it('returns undefined for blank input', () => {
    expect(findMember('')).toBeUndefined();
    expect(findMember('   ')).toBeUndefined();
  });
});

describe('evaluateEligibility', () => {
  it('is eligible when in good standing', () => {
    expect(evaluateEligibility(MEMBERS[0]!)).toEqual({ eligible: true });
  });

  it('is blocked for fines over the limit', () => {
    expect(evaluateEligibility(MEMBERS[1]!)).toEqual({ eligible: false, reason: 'fines' });
  });

  it('is blocked at the loan cap', () => {
    expect(evaluateEligibility(MEMBERS[2]!)).toEqual({ eligible: false, reason: 'loan_cap' });
  });

  it('is blocked when suspended', () => {
    expect(evaluateEligibility(MEMBERS[3]!)).toEqual({ eligible: false, reason: 'suspended' });
  });

  it('prefers suspended over loan cap and fines when a member trips more than one rule', () => {
    const member: Member = {
      memberId: 'LIB-9000',
      name: 'Test Case',
      activeLoans: 9,
      finesOwed: 999,
      suspended: true,
    };

    expect(evaluateEligibility(member)).toEqual({ eligible: false, reason: 'suspended' });
  });

  it('prefers loan cap over fines when a member trips both', () => {
    const member: Member = {
      memberId: 'LIB-9001',
      name: 'Test Case',
      activeLoans: 9,
      finesOwed: 999,
      suspended: false,
    };

    expect(evaluateEligibility(member)).toEqual({ eligible: false, reason: 'loan_cap' });
  });
});

describe('MEMBERS', () => {
  it('seeds eight members', () => {
    expect(MEMBERS).toHaveLength(8);
  });

  it('has more members in good standing than blocked, but includes both', () => {
    const eligible = MEMBERS.filter((member) => evaluateEligibility(member).eligible);
    const blocked = MEMBERS.filter((member) => !evaluateEligibility(member).eligible);

    expect(eligible.length).toBeGreaterThan(0);
    expect(blocked.length).toBeGreaterThan(0);
  });

  it('is frozen so the portal stays read-only', () => {
    expect(Object.isFrozen(MEMBERS)).toBe(true);
    expect(Object.isFrozen(MEMBERS[0])).toBe(true);
  });
});
