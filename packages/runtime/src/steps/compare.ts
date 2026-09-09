import type { ComparisonOperator, ValueCompareStep } from '@orbit/agent-ir';

import { RuntimeError } from '../errors';

/**
 * Resolving a `value.compare` step (ADR-040).
 *
 * The whole of the non-determinism budget this file spends is zero: both
 * operands are already in the run's scope by the time it is called, the answer
 * is a comparison, and the same run against the same values branches the same
 * way every time. That is the property that makes it the right resolution for a
 * written business rule -- a lender's threshold is a published number, and a
 * model asked to apply it would be slower, dearer, and occasionally wrong about
 * arithmetic nobody should be asking it to do.
 */

/**
 * Reads a number the way a business screen writes one.
 *
 * A loan origination system shows `$806,500` and `92.09%`, not `806500` and
 * `92.09`. A comparison that refused those would be a comparison no real
 * workflow could use, so the currency symbol, the thousands separators, the
 * percent sign and accounting parentheses are all understood.
 *
 * What it will not do is guess. Everything it accepts is spelled out below and
 * anything else returns undefined, which becomes a halted run rather than a
 * branch -- `1,2,3` is rejected rather than read as `123`, and `about 80` is
 * rejected rather than read as `80`. This parse decides whether a loan is
 * approved; being strict is cheaper than being wrong, and a halt names the raw
 * text so the fix is obvious.
 */
export function parseComparableNumber(raw: string): number | undefined {
  const trimmed = raw.trim();

  if (trimmed === '') {
    return undefined;
  }

  // Accounting notation: (1,234.00) is negative, a convention financial screens
  // still use in preference to a minus sign.
  const parenthesised = /^\((.*)\)$/.exec(trimmed);
  const body = (parenthesised?.[1] ?? trimmed).trim();

  const stripped = body
    .replace(/^[$£€¥]\s*/, '')
    .replace(/\s*%$/, '')
    .trim();

  // Either plain digits, or digits grouped in thousands. Grouping is checked
  // rather than stripped, so a malformed figure is refused instead of silently
  // becoming a different number.
  const plain = /^[+-]?\d+(\.\d+)?$/.test(stripped);
  const grouped = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(stripped);

  if (!plain && !grouped) {
    return undefined;
  }

  const value = Number(stripped.replace(/,/g, ''));

  if (!Number.isFinite(value)) {
    return undefined;
  }

  return parenthesised === null ? value : -value;
}

const ORDERED_OPERATORS = new Set<ComparisonOperator>(['gt', 'gte', 'lt', 'lte']);

export interface ComparisonResult {
  readonly holds: boolean;
  /** What the run actually compared, for the step's evidence. */
  readonly leftValue: string;
  readonly rightValue: string;
  readonly comparedAs: 'number' | 'text';
}

/**
 * Compares two resolved operands, or halts.
 *
 * Ordering operators require both sides to be numbers: `>` against something
 * that is not a number has no true answer and no false answer, so the run stops
 * rather than picking one. Equality falls back to text when either side is not
 * numeric, which is what makes `flood zone is not X` expressible without a
 * separate categorical operator -- and when both sides *are* numeric it compares
 * them as numbers, so `80` and `80.00` are equal, as the person who wrote the
 * rule plainly meant.
 */
export function compareValues(
  step: ValueCompareStep,
  leftValue: string,
  rightValue: string,
): ComparisonResult {
  const leftNumber = parseComparableNumber(leftValue);
  const rightNumber = parseComparableNumber(rightValue);
  const bothNumeric = leftNumber !== undefined && rightNumber !== undefined;

  if (ORDERED_OPERATORS.has(step.operator) && !bothNumeric) {
    const offending = leftNumber === undefined ? leftValue : rightValue;
    throw new RuntimeError({
      code: 'COMPARISON_NOT_COMPARABLE',
      message:
        `Step "${step.id}" compares whether one value is greater or less than another, ` +
        `but "${offending}" is not a number.`,
      agentStepId: step.id,
      details: [
        { field: 'left', message: leftValue },
        { field: 'right', message: rightValue },
        { field: 'operator', message: step.operator },
      ],
    });
  }

  const holds = bothNumeric
    ? compareNumbers(step.operator, leftNumber, rightNumber)
    : compareText(step.operator, leftValue, rightValue);

  return {
    holds,
    leftValue,
    rightValue,
    comparedAs: bothNumeric ? 'number' : 'text',
  };
}

function compareNumbers(operator: ComparisonOperator, left: number, right: number): boolean {
  switch (operator) {
    case 'gt':
      return left > right;
    case 'gte':
      return left >= right;
    case 'lt':
      return left < right;
    case 'lte':
      return left <= right;
    case 'eq':
      return left === right;
    case 'neq':
      return left !== right;
  }
}

/**
 * Text equality, trimmed and case-insensitive.
 *
 * A screen that renders a flood zone as `AE` in one place and `ae` in another
 * is describing the same zone, and a rule that treated them as different
 * conditions would be wrong in a way nobody would ever guess from reading it.
 * Ordering operators never reach here.
 */
function compareText(operator: ComparisonOperator, left: string, right: string): boolean {
  const same = left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
  return operator === 'neq' ? !same : same;
}
