import { describe, expect, it } from 'vitest';

import { apiSystemIdSchema } from '@orbit/contracts';

import { buildServer } from '../server';
import { createStubContext } from '../testing/stub-context';

/**
 * The wire contract for registering an API system, with no database.
 *
 * Pins the two defects a live registration attempt surfaced: a Zod validation
 * failure was sent as `{ error: { code, issues } }` with no `message`, which
 * the client's error parser cannot render into anything readable, and a
 * duplicate catalog id was reported with an invented `code: 'CONFLICT'` that
 * is not in the closed `ErrorCode` taxonomy at all.
 */
function server() {
  return buildServer({
    context: createStubContext({
      apiSystems: {
        byCatalogId: () => Promise.resolve(undefined),
        create: (input) =>
          Promise.resolve({
            id: apiSystemIdSchema.parse('apisys_01hzz0000000000000000000'),
            catalogId: input.catalogId,
            name: input.name,
            specText: input.specText,
            authScheme: input.authScheme,
            credentialRef: input.credentialRef ?? null,
            authHeaderName: input.authHeaderName ?? null,
            createdAt: new Date(0),
            updatedAt: new Date(0),
          }),
      },
    }),
    logLevel: 'silent',
  });
}

const VALID_SPEC = `
openapi: 3.0.0
info:
  title: Test
servers:
  - url: https://api.example.test
paths:
  /widgets/{id}:
    get:
      operationId: getWidget
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
`;

describe('POST /v1/api-systems', () => {
  it('registers a well-formed system', async () => {
    const app = server();
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/api-systems',
      payload: {
        catalogId: 'widget-service',
        name: 'Widget Service',
        spec: VALID_SPEC,
        authScheme: 'none',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ catalogId: 'widget-service' });
    await app.close();
  });

  it('rejects a malformed catalog id with a real, readable message', async () => {
    const app = server();
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/api-systems',
      payload: {
        catalogId: 'Widget Service', // capitals and a space: not `[a-z][a-z0-9_-]*`
        name: 'Widget Service',
        spec: VALID_SPEC,
        authScheme: 'none',
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    // The regression this pins: a client rendering `error.message` must have
    // something to show, not `undefined`.
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(typeof body.error.message).toBe('string');
    expect(body.error.message.length).toBeGreaterThan(0);
    expect(body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'catalogId' })]),
    );
    await app.close();
  });

  it('requires a credential name for an authenticated system', async () => {
    const app = server();
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/api-systems',
      payload: {
        catalogId: 'widget-service',
        name: 'Widget Service',
        spec: VALID_SPEC,
        authScheme: 'bearer',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('reports a duplicate catalog id as a real VALIDATION_ERROR, not an invented code', async () => {
    const app = buildServer({
      context: createStubContext({
        apiSystems: {
          byCatalogId: () =>
            Promise.resolve({
              id: apiSystemIdSchema.parse('apisys_01hzz0000000000000000001'),
              catalogId: 'widget-service',
              name: 'Existing',
              specText: VALID_SPEC,
              authScheme: 'none',
              credentialRef: null,
              authHeaderName: null,
              createdAt: new Date(0),
              updatedAt: new Date(0),
            }),
        },
      }),
      logLevel: 'silent',
    });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/api-systems',
      payload: {
        catalogId: 'widget-service',
        name: 'Widget Service',
        spec: VALID_SPEC,
        authScheme: 'none',
      },
    });

    expect(response.statusCode).toBe(409);
    // `CONFLICT` is not in the closed ErrorCode taxonomy; every close case in
    // this codebase collapses onto VALIDATION_ERROR with a distinguishing
    // status code instead (see `notFound`, and now `conflict`, in errors.ts).
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(response.json().error.message).toContain('widget-service');
    await app.close();
  });

  it('refuses a contract Orbit cannot import, naming what was skipped', async () => {
    const app = server();
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/api-systems',
      payload: {
        catalogId: 'widget-service',
        name: 'Widget Service',
        spec: 'not: [valid, openapi',
        authScheme: 'none',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(typeof response.json().error.message).toBe('string');
  });
});
