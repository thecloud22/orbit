import { describe, expect, it } from 'vitest';

import { buildServer } from './server';

describe('Orbit API', () => {
  it('answers the liveness probe', async () => {
    const app = buildServer({ logLevel: 'silent' });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });

    await app.close();
  });
});
