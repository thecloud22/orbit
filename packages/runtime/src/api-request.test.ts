import type { ApiCatalog } from '@orbit/api-catalog';
import { describe, expect, it } from 'vitest';

import { assertApiHost, buildRequestUrl, readJsonPointer } from './api-request';

const CATALOG: ApiCatalog = {
  id: 'service-desk',
  title: 'Service Desk',
  hosts: ['api.example.gov'],
  operations: [
    {
      operationId: 'getRequest',
      method: 'get',
      path: '/requests/{id}',
      parameters: [
        { name: 'id', location: 'path', required: true, type: 'string' },
        { name: 'expand', location: 'query', required: false, type: 'string' },
      ],
      idempotent: true,
    },
  ],
};

const OPERATION = CATALOG.operations[0];
if (OPERATION === undefined) throw new Error('fixture');

describe('building a request from a catalog operation', () => {
  it('fills named slots rather than concatenating a URL', () => {
    const url = buildRequestUrl(CATALOG, OPERATION, { id: 'SR-1001', expand: 'team' }, 'step');
    expect(url.toString()).toBe('https://api.example.gov/requests/SR-1001?expand=team');
  });

  it('encodes a value so it cannot escape into the structure of the request', () => {
    // The property that makes named slots safer than a template: a value
    // carrying a slash or a query separator stays one path segment.
    const url = buildRequestUrl(CATALOG, OPERATION, { id: '../admin?x=1' }, 'step');
    expect(url.pathname).toBe('/requests/..%2Fadmin%3Fx%3D1');
    expect(url.searchParams.has('x')).toBe(false);
  });

  it('refuses a missing required parameter', () => {
    expect(() => buildRequestUrl(CATALOG, OPERATION, {}, 'step')).toThrow(/required parameter/);
  });
});

describe('reading a response by JSON Pointer', () => {
  const body = { request: { status: 'In Progress', teams: ['ops', 'net'], open: true, count: 2 } };

  it('walks a path', () => {
    expect(readJsonPointer(body, '/request/status')).toBe('In Progress');
    expect(readJsonPointer(body, '/request/teams/1')).toBe('net');
    expect(readJsonPointer(body, '/request/open')).toBe('true');
    expect(readJsonPointer(body, '/request/count')).toBe('2');
  });

  it('reports a missing or non-scalar target as absent rather than stringifying it', () => {
    expect(readJsonPointer(body, '/request/missing')).toBeUndefined();
    // An object at the end of a pointer is not a value a workflow can compare.
    expect(readJsonPointer(body, '/request/teams')).toBeUndefined();
  });
});

describe('the host gate', () => {
  it('is the last check before a call leaves the machine', () => {
    expect(() =>
      assertApiHost(new URL('https://evil.example/x'), ['api.example.gov'], 'step'),
    ).toThrow(/does not permit/);

    expect(() =>
      assertApiHost(new URL('https://api.example.gov/x'), ['api.example.gov'], 'step'),
    ).not.toThrow();
  });
});
