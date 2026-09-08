import { eventTypeSchema } from '@orbit/contracts';
import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from './index';
import { EVENT_TYPES } from './schema';

describe('@orbit/db', () => {
  it('exposes its package identity', () => {
    expect(PACKAGE_NAME).toBe('@orbit/db');
  });
});

/**
 * The event vocabulary has two homes, and they must agree.
 *
 * `@orbit/contracts` owns the Zod enum every producer validates against;
 * `@orbit/db` holds its own copy because a CHECK constraint has to be a literal
 * list at migration time and cannot reach across a package boundary. That
 * duplication is deliberate, and it is exactly the kind of duplication that
 * drifts: adding a type to the enum and forgetting the constraint produces code
 * that typechecks, passes every unit test, and then silently drops the event at
 * run time — which is what happened while ADR-033 was being built, and is why
 * this test exists rather than the note that used to stand in for it.
 */
describe('the event type vocabulary', () => {
  it('is identical in @orbit/contracts and @orbit/db', () => {
    expect([...EVENT_TYPES]).toEqual([...eventTypeSchema.options]);
  });
});
