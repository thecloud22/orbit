import type { ReviewBindingResult } from '@orbit/sop-service';
import { describe, expect, it } from 'vitest';

import { buildServer } from '../app/server';
import { createStubContext } from '../testing/stub-context';

/**
 * Approving and rejecting a binding with no database.
 *
 * The two routes closing the gap this file is named for: every binding a
 * person demonstrates themselves is approved in the same sitting, and until
 * these existed there was no way to reach `draft -> needs_review -> approved
 * | rejected` from Watchtower for a binding demonstrated or proposed by
 * someone else.
 */
const BINDING_ID = 'execbind_01hzz0000000000000000000';

function bindingRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: BINDING_ID,
    documentId: 'sopdoc_01hzz0000000000000000000',
    stepId: 'enter_member_id',
    bindingNumber: 1,
    binding: {},
    bindingSha256: 'a'.repeat(64),
    state: 'approved',
    capturedAgainstRevisionId: null,
    parentBindingId: null,
    supersededByBindingId: null,
    reviewedAt: new Date('2026-09-09T00:00:00.000Z'),
    reviewNote: 'Confirmed by hand.',
    createdAt: new Date('2026-09-09T00:00:00.000Z'),
    updatedAt: new Date('2026-09-09T00:00:00.000Z'),
    ...overrides,
  } as never;
}

function approveServer(approve: (id: string, note?: string) => Promise<ReviewBindingResult>) {
  return buildServer({
    context: createStubContext({ bindingReview: { approve: approve as never } }),
    logLevel: 'silent',
  });
}

function rejectServer(reject: (id: string, note?: string) => Promise<ReviewBindingResult>) {
  return buildServer({
    context: createStubContext({ bindingReview: { reject: reject as never } }),
    logLevel: 'silent',
  });
}

describe('POST /v1/execution-bindings/:bindingId/approve', () => {
  it('approves and describes the resulting binding', async () => {
    const binding = bindingRecord({ state: 'approved' });
    const app = approveServer(() => Promise.resolve({ ok: true, binding }));

    const response = await app.inject({
      method: 'POST',
      url: `/v1/execution-bindings/${BINDING_ID}/approve`,
      payload: { note: 'Checked by hand.' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.state).toBe('approved');
    expect(response.json().data.stepId).toBe('enter_member_id');

    await app.close();
  });

  it('accepts an approval with no note', async () => {
    const app = approveServer(() =>
      Promise.resolve({ ok: true, binding: bindingRecord({ state: 'approved' }) }),
    );

    const response = await app.inject({
      method: 'POST',
      url: `/v1/execution-bindings/${BINDING_ID}/approve`,
    });

    expect(response.statusCode).toBe(200);

    await app.close();
  });

  it('refuses to approve a binding that is not draft or waiting for review', async () => {
    const app = approveServer(() =>
      Promise.resolve({ ok: false, reason: 'illegal_transition', state: 'approved' }),
    );

    const response = await app.inject({
      method: 'POST',
      url: `/v1/execution-bindings/${BINDING_ID}/approve`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('approved');

    await app.close();
  });

  it('reports an unknown binding as missing', async () => {
    const app = approveServer(() => Promise.resolve({ ok: false, reason: 'not_found' }));

    const response = await app.inject({
      method: 'POST',
      url: `/v1/execution-bindings/${BINDING_ID}/approve`,
    });

    expect(response.statusCode).toBe(404);

    await app.close();
  });

  it('rejects a binding id that is not an Orbit identifier', async () => {
    const app = approveServer(() => {
      throw new Error('the service must not be called for a malformed id');
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/execution-bindings/not-an-orbit-id/approve',
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });
});

describe('POST /v1/execution-bindings/:bindingId/reject', () => {
  it('rejects and describes the resulting binding', async () => {
    const binding = bindingRecord({ state: 'rejected' });
    const app = rejectServer(() => Promise.resolve({ ok: true, binding }));

    const response = await app.inject({
      method: 'POST',
      url: `/v1/execution-bindings/${BINDING_ID}/reject`,
      payload: { note: 'This points at the wrong field.' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.state).toBe('rejected');

    await app.close();
  });

  it('refuses to reject a binding that is not draft or waiting for review', async () => {
    const app = rejectServer(() =>
      Promise.resolve({ ok: false, reason: 'illegal_transition', state: 'superseded' }),
    );

    const response = await app.inject({
      method: 'POST',
      url: `/v1/execution-bindings/${BINDING_ID}/reject`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('superseded');

    await app.close();
  });

  it('reports an unknown binding as missing', async () => {
    const app = rejectServer(() => Promise.resolve({ ok: false, reason: 'not_found' }));

    const response = await app.inject({
      method: 'POST',
      url: `/v1/execution-bindings/${BINDING_ID}/reject`,
    });

    expect(response.statusCode).toBe(404);

    await app.close();
  });
});
