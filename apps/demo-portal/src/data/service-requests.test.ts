import { describe, expect, it } from 'vitest';

import { findServiceRequest, SERVICE_REQUESTS } from './service-requests';

describe('findServiceRequest', () => {
  it('returns the seeded request for SR-1001', () => {
    const request = findServiceRequest('SR-1001');

    expect(request).toEqual({
      requestNumber: 'SR-1001',
      status: 'In Progress',
      assignedTeam: 'Infrastructure Operations',
    });
  });

  it('returns undefined for the unknown request SR-9999', () => {
    expect(findServiceRequest('SR-9999')).toBeUndefined();
  });

  it('trims surrounding whitespace before looking up', () => {
    expect(findServiceRequest('  SR-1001  ')).toEqual(SERVICE_REQUESTS[0]);
  });

  it('matches case-sensitively so the displayed number equals the requested one', () => {
    expect(findServiceRequest('sr-1001')).toBeUndefined();
  });

  it('returns undefined for blank input', () => {
    expect(findServiceRequest('')).toBeUndefined();
    expect(findServiceRequest('   ')).toBeUndefined();
  });
});

describe('SERVICE_REQUESTS', () => {
  it('seeds exactly the one Phase 1 record', () => {
    expect(SERVICE_REQUESTS).toHaveLength(1);
    expect(SERVICE_REQUESTS[0]?.requestNumber).toBe('SR-1001');
  });

  it('is frozen so the portal stays read-only', () => {
    expect(Object.isFrozen(SERVICE_REQUESTS)).toBe(true);
    expect(Object.isFrozen(SERVICE_REQUESTS[0])).toBe(true);
  });
});
