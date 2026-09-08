import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from './index';
import { grantsSurface, permissionsSchema, stepPermissionFor } from './permissions';

describe('@orbit/agent-ir', () => {
  it('exposes its package identity', () => {
    expect(PACKAGE_NAME).toBe('@orbit/agent-ir');
  });
});

describe('permissions are keyed by surface', () => {
  it('parses a declaration that grants no browser surface', () => {
    // The change that lets an Agent Version exist which never opens a browser.
    // Nothing uses it yet -- no non-browser step type exists -- but the contract
    // has to admit it before a surface can be added (ADR-037).
    const parsed = permissionsSchema.safeParse({ model: { allowed: true, maxCallsPerRun: 1 } });
    expect(parsed.success).toBe(true);
  });

  it('reports the surface a step consumes, and nothing for a terminator', () => {
    expect(stepPermissionFor('browser.click')).toEqual({ surface: 'browser', action: 'click' });
    expect(stepPermissionFor('complete')).toBeUndefined();
    expect(stepPermissionFor('fail')).toBeUndefined();
    // A judged decision consumes permissions.model, which is a capability
    // rather than a surface, so it maps to no surface permission.
    expect(stepPermissionFor('model.decide')).toBeUndefined();
  });

  it('treats an absent section as denied rather than as a default', () => {
    expect(
      grantsSurface({ browser: { allowedDomains: ['x'], allowedActions: ['click'] } }, 'browser'),
    ).toBe(true);
    expect(grantsSurface({}, 'browser')).toBe(false);
  });
});
