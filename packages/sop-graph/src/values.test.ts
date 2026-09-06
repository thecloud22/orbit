import { describe, expect, it } from 'vitest';

import { classifyValue } from './values';

describe('classifyValue', () => {
  it('classifies a plain string as a literal', () => {
    expect(classifyValue('plain text')).toEqual({ kind: 'literal', value: 'plain text' });
  });

  it('classifies ${inputs.name} as an inputs reference', () => {
    const classified = classifyValue('${inputs.requestNumber}');

    expect(classified.kind).toBe('reference');
    if (classified.kind !== 'reference') {
      throw new Error('expected a reference');
    }

    expect(classified.reference).toEqual({
      namespace: 'inputs',
      name: 'requestNumber',
      raw: '${inputs.requestNumber}',
    });
  });

  it('classifies ${variables.name} as a variables reference', () => {
    const classified = classifyValue('${variables.assignedTeam}');

    expect(classified.kind).toBe('reference');
    if (classified.kind !== 'reference') {
      throw new Error('expected a reference');
    }

    expect(classified.reference.namespace).toBe('variables');
    expect(classified.reference.name).toBe('assignedTeam');
  });

  it('classifies an unterminated reference as malformed', () => {
    expect(classifyValue('${inputs.requestNumber').kind).toBe('malformed');
  });

  it('classifies a reference with surrounding text as malformed, not concatenated', () => {
    expect(classifyValue('prefix ${inputs.x} suffix').kind).toBe('malformed');
  });

  it('classifies an unknown namespace as malformed', () => {
    expect(classifyValue('${result.foo}').kind).toBe('malformed');
  });
});
