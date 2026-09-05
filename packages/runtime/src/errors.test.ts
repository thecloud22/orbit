import { orbitErrorSchema } from '@orbit/contracts';
import { describe, expect, it } from 'vitest';

import { asRuntimeError, describeCause, isRuntimeError, RuntimeError } from './errors';

describe('RuntimeError.toOrbitError', () => {
  it('omits details entirely when there are none', () => {
    const error = new RuntimeError({ code: 'INTERNAL_ERROR', message: 'Something went wrong.' });

    const orbitError = error.toOrbitError();

    expect(orbitError).toEqual({ code: 'INTERNAL_ERROR', message: 'Something went wrong.' });
    expect(orbitError).not.toHaveProperty('details');
  });

  it('includes details when present', () => {
    const error = new RuntimeError({
      code: 'VALIDATION_ERROR',
      message: 'Invalid.',
      details: [{ field: 'schemaVersion', message: 'is not supported.' }],
    });

    const orbitError = error.toOrbitError();

    expect(orbitError.details).toEqual([{ field: 'schemaVersion', message: 'is not supported.' }]);
  });

  it('produces an Orbit error that satisfies orbitErrorSchema', () => {
    const withoutDetails = new RuntimeError({
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong.',
    });
    const withDetails = new RuntimeError({
      code: 'VALIDATION_ERROR',
      message: 'Invalid.',
      details: [{ field: 'schemaVersion', message: 'is not supported.' }],
    });

    expect(() => orbitErrorSchema.parse(withoutDetails.toOrbitError())).not.toThrow();
    expect(() => orbitErrorSchema.parse(withDetails.toOrbitError())).not.toThrow();
  });
});

describe('isRuntimeError', () => {
  it('distinguishes a RuntimeError from a plain Error', () => {
    expect(isRuntimeError(new RuntimeError({ code: 'INTERNAL_ERROR', message: 'x' }))).toBe(true);
    expect(isRuntimeError(new Error('x'))).toBe(false);
    expect(isRuntimeError('x')).toBe(false);
    expect(isRuntimeError(undefined)).toBe(false);
  });
});

describe('asRuntimeError', () => {
  it('returns the same instance when given a RuntimeError', () => {
    const original = new RuntimeError({ code: 'LOCATOR_NOT_FOUND', message: 'Not found.' });

    const result = asRuntimeError(original, {});

    expect(result).toBe(original);
  });

  it('wraps a plain Error as INTERNAL_ERROR, keeps the original as cause, and never copies its message', () => {
    const original = new Error(
      'Timeout 30000ms exceeded while waiting for locator. Call log: page content dump...',
    );

    const wrapped = asRuntimeError(original, {});

    expect(wrapped.code).toBe('INTERNAL_ERROR');
    expect(wrapped.cause).toBe(original);
    expect(wrapped.message).not.toContain('Timeout 30000ms exceeded');
    expect(wrapped.message).not.toContain('page content dump');
  });

  it('applies the agentStepId from context', () => {
    const wrapped = asRuntimeError(new Error('x'), { agentStepId: 'submit_request_search' });

    expect(wrapped.agentStepId).toBe('submit_request_search');
  });
});

describe('describeCause', () => {
  it('returns an Error message', () => {
    expect(describeCause(new Error('boom'))).toBe('boom');
  });

  it('returns a string as-is', () => {
    expect(describeCause('already a string')).toBe('already a string');
  });

  it('returns undefined for other values', () => {
    expect(describeCause(42)).toBeUndefined();
    expect(describeCause({ message: 'not an Error instance' })).toBeUndefined();
    expect(describeCause(undefined)).toBeUndefined();
    expect(describeCause(null)).toBeUndefined();
  });
});
