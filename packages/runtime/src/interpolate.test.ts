import { describe, expect, it } from 'vitest';

import { isRuntimeError, type RuntimeError } from './errors';
import { resolveValue, type ResolutionScope, type ValuePosition } from './interpolate';

const STEP_ID = 'enter_request_number';

function scope(overrides: Partial<ResolutionScope> = {}): ResolutionScope {
  return {
    inputs: {},
    variables: {},
    ...overrides,
  };
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
  throw new Error('expected resolveValue to throw a RuntimeError');
}

describe('resolveValue — literals', () => {
  const positions: readonly ValuePosition[] = ['value', 'expected', 'assign', 'output'];

  it.each(positions)('resolves a literal string to itself in position "%s"', (position) => {
    expect(resolveValue('a plain literal', position, scope(), STEP_ID)).toBe('a plain literal');
  });
});

describe('resolveValue — references', () => {
  it('resolves ${inputs.requestNumber} from scope.inputs in position "value"', () => {
    const result = resolveValue(
      '${inputs.requestNumber}',
      'value',
      scope({ inputs: { requestNumber: 'SR-1001' } }),
      STEP_ID,
    );

    expect(result).toBe('SR-1001');
  });

  it('resolves ${inputs.requestNumber} from scope.inputs in position "expected"', () => {
    const result = resolveValue(
      '${inputs.requestNumber}',
      'expected',
      scope({ inputs: { requestNumber: 'SR-1001' } }),
      STEP_ID,
    );

    expect(result).toBe('SR-1001');
  });

  it('resolves ${variables.requestStatus} from scope.variables in position "value"', () => {
    const result = resolveValue(
      '${variables.requestStatus}',
      'value',
      scope({ variables: { requestStatus: 'In Progress' } }),
      STEP_ID,
    );

    expect(result).toBe('In Progress');
  });

  it('resolves ${variables.requestStatus} from scope.variables in position "output"', () => {
    const result = resolveValue(
      '${variables.requestStatus}',
      'output',
      scope({ variables: { requestStatus: 'In Progress' } }),
      STEP_ID,
    );

    expect(result).toBe('In Progress');
  });

  it('resolves ${result.requestStatus} from scope.result in position "assign"', () => {
    const result = resolveValue(
      '${result.requestStatus}',
      'assign',
      scope({ result: { requestStatus: 'In Progress' } }),
      STEP_ID,
    );

    expect(result).toBe('In Progress');
  });
});

describe('resolveValue — rejections', () => {
  it('throws INTERNAL_ERROR when the namespace is not allowed in "value"', () => {
    const error = captureRuntimeError(() =>
      resolveValue('${result.x}', 'value', scope({ result: { x: 'y' } }), STEP_ID),
    );

    expect(error.code).toBe('INTERNAL_ERROR');
  });

  it('throws INTERNAL_ERROR when the namespace is not allowed in "assign"', () => {
    const error = captureRuntimeError(() =>
      resolveValue('${inputs.x}', 'assign', scope({ inputs: { x: 'y' } }), STEP_ID),
    );

    expect(error.code).toBe('INTERNAL_ERROR');
  });

  it('throws INTERNAL_ERROR when the referenced name has no value in scope', () => {
    const error = captureRuntimeError(() =>
      resolveValue('${inputs.missing}', 'value', scope(), STEP_ID),
    );

    expect(error.code).toBe('INTERNAL_ERROR');
  });

  it('throws INTERNAL_ERROR when the value is malformed', () => {
    const error = captureRuntimeError(() =>
      resolveValue('${inputs.requestNumber', 'value', scope(), STEP_ID),
    );

    expect(error.code).toBe('INTERNAL_ERROR');
  });

  it('carries the agentStepId it was given', () => {
    const error = captureRuntimeError(() =>
      resolveValue('${inputs.missing}', 'value', scope(), STEP_ID),
    );

    expect(error.agentStepId).toBe(STEP_ID);
  });
});
