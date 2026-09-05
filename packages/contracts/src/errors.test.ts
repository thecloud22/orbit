import { describe, expect, it } from 'vitest';

import { errorCodeSchema, orbitErrorSchema } from './errors';

describe('error taxonomy', () => {
  it('accepts the Phase 1 error codes', () => {
    expect(errorCodeSchema.parse('LOCATOR_NOT_FOUND')).toBe('LOCATOR_NOT_FOUND');
    expect(errorCodeSchema.parse('UNEXPECTED_UI_STATE')).toBe('UNEXPECTED_UI_STATE');
  });

  it('rejects a business outcome masquerading as an error code', () => {
    expect(errorCodeSchema.safeParse('REQUEST_NOT_FOUND').success).toBe(false);
  });

  it('accepts a structured error with field details', () => {
    const parsed = orbitErrorSchema.parse({
      code: 'INPUT_ERROR',
      message: 'requestNumber is required.',
      requestId: 'req_01JABC',
      details: [{ field: 'inputs.requestNumber', message: 'Required' }],
    });

    expect(parsed.details?.[0]?.field).toBe('inputs.requestNumber');
  });

  it('rejects unknown keys so error shapes cannot drift', () => {
    expect(
      orbitErrorSchema.safeParse({ code: 'INTERNAL_ERROR', message: 'x', stack: 'leaky' }).success,
    ).toBe(false);
  });
});
