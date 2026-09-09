import type { AgentIr } from '@orbit/agent-ir';
import { describe, expect, it } from 'vitest';

import { isRuntimeError, type RuntimeError } from '../errors';
import { validateRunInputs } from './inputs';
import { loadFixtureAgentIr } from '../testing/fixture';

function declarations(): AgentIr['inputs'] {
  return loadFixtureAgentIr().inputs;
}

function captureRuntimeError(fn: () => unknown): RuntimeError {
  try {
    fn();
  } catch (error) {
    if (isRuntimeError(error)) {
      return error;
    }
    throw error;
  }
  throw new Error('expected validateRunInputs to throw a RuntimeError');
}

describe('validateRunInputs', () => {
  it('accepts a value satisfying the declarations and returns it', () => {
    const result = validateRunInputs(declarations(), { requestNumber: 'SR-1001' });

    expect(result).toEqual({ requestNumber: 'SR-1001' });
  });

  it('throws INPUT_ERROR when a required input is missing', () => {
    const error = captureRuntimeError(() => validateRunInputs(declarations(), {}));

    expect(error.code).toBe('INPUT_ERROR');
    expect(error.details.some((detail) => detail.field === 'requestNumber')).toBe(true);
  });

  it('throws INPUT_ERROR when the value is not a string', () => {
    const error = captureRuntimeError(() =>
      validateRunInputs(declarations(), { requestNumber: 12345 }),
    );

    expect(error.code).toBe('INPUT_ERROR');
    expect(error.details.some((detail) => detail.field === 'requestNumber')).toBe(true);
  });

  it('throws INPUT_ERROR when the value is shorter than minLength', () => {
    const error = captureRuntimeError(() =>
      validateRunInputs(declarations(), { requestNumber: '' }),
    );

    expect(error.code).toBe('INPUT_ERROR');
    expect(error.details.some((detail) => detail.field === 'requestNumber')).toBe(true);
  });

  it('throws INPUT_ERROR when the value is longer than maxLength', () => {
    const error = captureRuntimeError(() =>
      validateRunInputs(declarations(), { requestNumber: 'a'.repeat(101) }),
    );

    expect(error.code).toBe('INPUT_ERROR');
    expect(error.details.some((detail) => detail.field === 'requestNumber')).toBe(true);
  });

  it('reports an undeclared input key as an error detail whose field is that key', () => {
    const error = captureRuntimeError(() =>
      validateRunInputs(declarations(), { requestNumber: 'SR-1001', extraField: 'x' }),
    );

    expect(error.code).toBe('INPUT_ERROR');
    expect(error.details.some((detail) => detail.field === 'extraField')).toBe(true);
  });

  it('collects multiple problems into multiple details in one throw', () => {
    const error = captureRuntimeError(() => validateRunInputs(declarations(), { extraField: 'x' }));

    expect(error.code).toBe('INPUT_ERROR');
    expect(error.details.length).toBeGreaterThan(1);
    expect(error.details.some((detail) => detail.field === 'requestNumber')).toBe(true);
    expect(error.details.some((detail) => detail.field === 'extraField')).toBe(true);
  });

  it('returns an object containing only declared inputs', () => {
    const result = validateRunInputs(declarations(), { requestNumber: 'SR-1001' });

    expect(Object.keys(result)).toEqual(['requestNumber']);
  });
});
