import { describe, expect, it } from 'vitest';

import { createHttpExecutorFactory } from './index';

function stubFetch(status: number, body: unknown): typeof globalThis.fetch {
  return (() =>
    Promise.resolve(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
    )) as unknown as typeof globalThis.fetch;
}

describe('the http executor', () => {
  it('issues exactly the request it is handed and parses a JSON body', async () => {
    const executor = await createHttpExecutorFactory({
      fetch: stubFetch(200, { status: 'In Progress' }),
    }).open();

    const result = await executor.send({
      method: 'GET',
      url: 'https://api.example.gov/v1/requests/SR-1001',
      headers: { accept: 'application/json' },
      timeoutMs: 5_000,
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ status: 'In Progress' });
  });

  it('records the exchange as evidence with sensitive headers redacted', async () => {
    const executor = await createHttpExecutorFactory({
      fetch: stubFetch(200, { ok: true }),
    }).open();

    await executor.send({
      method: 'GET',
      url: 'https://api.example.gov/v1/requests',
      headers: { accept: 'application/json', authorization: 'Bearer super-secret-token' },
      timeoutMs: 5_000,
    });

    const evidence = await executor.finishEvidence();
    const text = new TextDecoder().decode(evidence[0]?.bytes ?? new Uint8Array());

    // Redacted by header *name*: a bearer token and an ordinary string are
    // indistinguishable once they are both strings.
    expect(text).not.toContain('super-secret-token');
    expect(text).toContain('[redacted]');
    expect(text).toContain('api.example.gov');
    expect(evidence[0]?.kind).toBe('api_exchange');
  });

  it('does not treat a non-JSON body as a failure', async () => {
    const executor = await createHttpExecutorFactory({
      fetch: stubFetch(200, 'plain text'),
    }).open();

    const result = await executor.send({
      method: 'GET',
      url: 'https://api.example.gov/v1/x',
      headers: {},
      timeoutMs: 5_000,
    });

    // The step's assign block decides whether the shape it needed was there.
    expect(result.status).toBe(200);
    expect(result.body).toBeNull();
    expect(result.text).toBe('plain text');
  });

  it('produces no evidence when no request was made', async () => {
    const executor = await createHttpExecutorFactory({ fetch: stubFetch(200, {}) }).open();
    await expect(executor.finishEvidence()).resolves.toEqual([]);
  });
});
