import { describe, expect, it } from 'vitest';

import { classifyInterpolation } from './interpolation';

describe('classifyInterpolation', () => {
  it('recognises input, variable, and result references', () => {
    expect(classifyInterpolation('${inputs.requestNumber}')).toEqual({
      kind: 'reference',
      reference: { namespace: 'inputs', name: 'requestNumber', raw: '${inputs.requestNumber}' },
    });

    expect(classifyInterpolation('${variables.requestStatus}').kind).toBe('reference');
    expect(classifyInterpolation('${result.assignedTeam}').kind).toBe('reference');
  });

  it('treats a plain string as a literal', () => {
    expect(classifyInterpolation('SR-1001')).toEqual({ kind: 'literal', value: 'SR-1001' });
  });

  it('flags an unclosed reference rather than silently accepting a literal', () => {
    expect(classifyInterpolation('${inputs.requestNumber').kind).toBe('malformed');
  });

  it('rejects an unknown namespace', () => {
    expect(classifyInterpolation('${secrets.apiToken}').kind).toBe('malformed');
  });

  it('rejects concatenation, so no value can be assembled from parts', () => {
    expect(classifyInterpolation('prefix-${inputs.requestNumber}').kind).toBe('malformed');
    expect(classifyInterpolation('${inputs.a}${inputs.b}').kind).toBe('malformed');
  });

  it('rejects nested property access', () => {
    expect(classifyInterpolation('${inputs.request.number}').kind).toBe('malformed');
  });

  it('rejects an expression rather than evaluating it', () => {
    expect(classifyInterpolation('${1 + 1}').kind).toBe('malformed');
    expect(classifyInterpolation('${process.env.HOME}').kind).toBe('malformed');
  });
});
