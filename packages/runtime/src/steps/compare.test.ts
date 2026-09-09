import { describe, expect, it } from 'vitest';

import type { ValueCompareStep } from '@orbit/agent-ir';

import { isRuntimeError } from '../errors';
import { compareValues, parseComparableNumber } from './compare';

function step(overrides: Partial<ValueCompareStep> = {}): ValueCompareStep {
  return {
    id: 'over_pmi_threshold',
    sourceSopStepIds: ['over_pmi_threshold'],
    type: 'value.compare',
    left: '${variables.loanToValue}',
    operator: 'gt',
    right: '80',
    whenTrue: 'add_pmi',
    whenFalse: 'approve',
    ...overrides,
  };
}

describe('parseComparableNumber', () => {
  it('reads the shapes a business screen actually renders', () => {
    expect(parseComparableNumber('92.09')).toBe(92.09);
    expect(parseComparableNumber('92.09%')).toBe(92.09);
    expect(parseComparableNumber('$806,500')).toBe(806_500);
    expect(parseComparableNumber('$ 806,500.55')).toBe(806_500.55);
    expect(parseComparableNumber('  762  ')).toBe(762);
    expect(parseComparableNumber('-3.5')).toBe(-3.5);
  });

  it('reads accounting parentheses as a negative', () => {
    expect(parseComparableNumber('(1,234.00)')).toBe(-1234);
    expect(parseComparableNumber('($500)')).toBe(-500);
  });

  it('refuses anything it would have to guess at', () => {
    // Each of these is a way a wrong number could enter a lending decision
    // silently. `1,2,3` is the one that matters most: stripping separators
    // without checking the grouping would read it as 123.
    expect(parseComparableNumber('1,2,3')).toBeUndefined();
    expect(parseComparableNumber('about 80')).toBeUndefined();
    expect(parseComparableNumber('80 percent')).toBeUndefined();
    expect(parseComparableNumber('AE')).toBeUndefined();
    expect(parseComparableNumber('')).toBeUndefined();
    expect(parseComparableNumber('   ')).toBeUndefined();
    expect(parseComparableNumber('12.3.4')).toBeUndefined();
    expect(parseComparableNumber('NaN')).toBeUndefined();
    expect(parseComparableNumber('Infinity')).toBeUndefined();
  });
});

describe('compareValues', () => {
  it('decides a threshold the way the rule reads', () => {
    expect(compareValues(step(), '92.09%', '80').holds).toBe(true);
    expect(compareValues(step(), '75.00%', '80').holds).toBe(false);
  });

  it('is exact at the boundary, where a threshold actually matters', () => {
    // 80.00 is not "over 80". A lender's PMI threshold is written as a strict
    // comparison and a file sitting exactly on it must not be conditioned.
    expect(compareValues(step({ operator: 'gt' }), '80.00%', '80').holds).toBe(false);
    expect(compareValues(step({ operator: 'gte' }), '80.00%', '80').holds).toBe(true);
    expect(compareValues(step({ operator: 'lt' }), '620', '620').holds).toBe(false);
    expect(compareValues(step({ operator: 'lte' }), '620', '620').holds).toBe(true);
  });

  it('compares two numbers as numbers, not as the text they were written in', () => {
    const result = compareValues(step({ operator: 'eq' }), '80', '80.00');

    expect(result.holds).toBe(true);
    expect(result.comparedAs).toBe('number');
  });

  it('falls back to text for equality when a side is not a number', () => {
    const flood = step({ operator: 'neq', left: '${variables.floodZone}', right: 'X' });

    expect(compareValues(flood, 'AE', 'X').holds).toBe(true);
    expect(compareValues(flood, 'X', 'X').holds).toBe(false);
    expect(compareValues(flood, 'AE', 'X').comparedAs).toBe('text');
  });

  it('treats the same value in a different case as the same value', () => {
    const flood = step({ operator: 'eq', left: '${variables.floodZone}', right: 'X' });
    expect(compareValues(flood, ' x ', 'X').holds).toBe(true);
  });

  it('halts rather than guessing when an ordering compares something unorderable', () => {
    // The failure this exists to prevent: "is not a number" has no true answer
    // and no false answer, and either default would route a loan on a value
    // nobody could reconstruct afterwards.
    try {
      compareValues(step(), 'Not available', '80');
      expect.unreachable('a non-numeric ordering comparison must halt the run');
    } catch (caught) {
      expect(isRuntimeError(caught)).toBe(true);
      if (isRuntimeError(caught)) {
        expect(caught.code).toBe('COMPARISON_NOT_COMPARABLE');
        // The raw text is in the message, because the fix is almost always
        // "the screen showed something the workflow did not expect".
        expect(caught.message).toContain('Not available');
      }
    }
  });

  it('names the offending side when it is the right-hand one', () => {
    try {
      compareValues(step({ right: '${variables.threshold}' }), '92.09', 'unknown');
      expect.unreachable('a non-numeric ordering comparison must halt the run');
    } catch (caught) {
      expect(isRuntimeError(caught)).toBe(true);
      if (isRuntimeError(caught)) {
        expect(caught.message).toContain('unknown');
      }
    }
  });

  it('reports what it compared, so evidence can be checked by hand', () => {
    const result = compareValues(step(), '$930,000', '$806,500');

    expect(result).toEqual({
      holds: true,
      leftValue: '$930,000',
      rightValue: '$806,500',
      comparedAs: 'number',
    });
  });
});
