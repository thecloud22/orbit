export interface Member {
  readonly memberId: string;
  readonly name: string;
  readonly activeLoans: number;
  readonly finesOwed: number;
  readonly suspended: boolean;
}

/**
 * Seeded members for the circulation desk lookup and event registration.
 *
 * Each record is built to trip exactly one eligibility rule, so a lookup on
 * any one of them exercises a single, unambiguous branch of
 * evaluateEligibility below. LIB-1001 through LIB-1004 are the original four
 * (one per rule); LIB-1005 through LIB-1008 add more good-standing members
 * plus a second fines case and a second suspension, so there's a real mix
 * rather than one example of each.
 */
export const MEMBERS: readonly Member[] = Object.freeze([
  Object.freeze({
    memberId: 'LIB-1001',
    name: 'Dana Whitfield',
    activeLoans: 2,
    finesOwed: 0,
    suspended: false,
  }),
  Object.freeze({
    memberId: 'LIB-1002',
    name: 'Ravi Chandran',
    activeLoans: 2,
    finesOwed: 12.5,
    suspended: false,
  }),
  Object.freeze({
    memberId: 'LIB-1003',
    name: 'Elena Voss',
    activeLoans: 5,
    finesOwed: 0,
    suspended: false,
  }),
  Object.freeze({
    memberId: 'LIB-1004',
    name: 'Marcus Boyd',
    activeLoans: 1,
    finesOwed: 0,
    suspended: true,
  }),
  Object.freeze({
    memberId: 'LIB-1005',
    name: 'Priya Nandakumar',
    activeLoans: 1,
    finesOwed: 0,
    suspended: false,
  }),
  Object.freeze({
    memberId: 'LIB-1006',
    name: 'Thomas Reyes',
    activeLoans: 0,
    finesOwed: 0,
    suspended: false,
  }),
  Object.freeze({
    memberId: 'LIB-1007',
    name: 'Ingrid Larsson',
    activeLoans: 2,
    finesOwed: 15.75,
    suspended: false,
  }),
  Object.freeze({
    memberId: 'LIB-1008',
    name: 'Carlos Duarte',
    activeLoans: 1,
    finesOwed: 0,
    suspended: true,
  }),
]) as readonly Member[];

export function findMember(memberId: string): Member | undefined {
  const normalized = memberId.trim();

  if (normalized.length === 0) {
    return undefined;
  }

  return MEMBERS.find((member) => member.memberId === normalized);
}

/** A member may not owe more than this and still borrow. */
export const FINE_LIMIT = 10;

/** A member at or above this many active loans may not borrow more. */
export const LOAN_CAP = 5;

export type EligibilityReason = 'suspended' | 'loan_cap' | 'fines';

export type Eligibility =
  { readonly eligible: true } | { readonly eligible: false; readonly reason: EligibilityReason };

const REASON_TEXT: Record<EligibilityReason, string> = {
  suspended: 'Membership is suspended.',
  loan_cap: `At the ${LOAN_CAP}-item loan limit.`,
  fines: `Owes more than $${FINE_LIMIT.toFixed(2)} in fines.`,
};

export function describeEligibilityReason(reason: EligibilityReason): string {
  return REASON_TEXT[reason];
}

/**
 * Decides whether a member may borrow.
 *
 * Checked in a fixed order — suspended, then loan cap, then fines — so a
 * member who trips more than one rule still gets one deterministic reason
 * rather than a list. Suspension is an administrative decision and is
 * checked first because it overrides the numeric thresholds below it; the
 * loan cap is a hard count checked before the fine amount, which is the
 * softer, purely monetary rule.
 */
export function evaluateEligibility(member: Member): Eligibility {
  if (member.suspended) {
    return { eligible: false, reason: 'suspended' };
  }

  if (member.activeLoans >= LOAN_CAP) {
    return { eligible: false, reason: 'loan_cap' };
  }

  if (member.finesOwed > FINE_LIMIT) {
    return { eligible: false, reason: 'fines' };
  }

  return { eligible: true };
}
