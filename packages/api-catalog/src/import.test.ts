import { describe, expect, it } from 'vitest';

import { operationById } from './catalog';
import { importOpenApi } from './import';

const DOCUMENT = {
  info: { title: 'Service Desk' },
  servers: [{ url: 'https://api.example.gov/v1' }],
  paths: {
    '/requests/{id}': {
      get: {
        operationId: 'getRequest',
        summary: 'Fetch one service request',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      },
      post: { operationId: 'createRequest', parameters: [] },
    },
    '/requests': {
      get: {
        operationId: 'listRequests',
        parameters: [{ name: 'status', in: 'query', required: false, schema: { type: 'string' } }],
      },
    },
  },
};

describe('importing an OpenAPI contract', () => {
  it('imports safe operations and derives the hosts a permission grant will use', () => {
    const result = importOpenApi('service-desk', DOCUMENT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.catalog.operations.map((one) => one.operationId).sort()).toEqual([
      'getRequest',
      'listRequests',
    ]);
    // Derived from the contract, never typed in — the pattern ADR-022 set for
    // allowedDomains.
    expect(result.catalog.hosts).toEqual(['api.example.gov']);
    expect(operationById(result.catalog, 'getRequest')?.path).toBe('/requests/{id}');
  });

  it('refuses a non-idempotent operation by name rather than importing it', () => {
    const result = importOpenApi('service-desk', DOCUMENT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Named, not silently dropped: a reviewer has to be able to see that POST
    // was understood and excluded, rather than missed.
    expect(result.refusals).toContainEqual({
      operationId: 'createRequest',
      reason: 'not_idempotent',
      detail: 'POST needs the idempotency-key design deferred to Phase 5.',
    });
  });

  it('refuses a parameter Agent IR could not carry', () => {
    const result = importOpenApi('x', {
      servers: [{ url: 'https://h.example' }],
      paths: {
        '/a': {
          get: {
            operationId: 'a',
            parameters: [{ name: 'count', in: 'query', schema: { type: 'integer' } }],
          },
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.refusals[0]?.reason).toBe('unsupported_parameter_type');
  });

  it('refuses a $ref rather than guessing at it', () => {
    const result = importOpenApi('x', {
      servers: [{ url: 'https://h.example' }],
      paths: { '/a': { get: { operationId: 'a', parameters: [{ $ref: '#/x' }] } } },
    });

    expect(result.ok === false && result.refusals[0]?.reason).toBe('unresolved_reference');
  });

  it('refuses a document with no absolute server URL, because no host could be permitted', () => {
    const result = importOpenApi('x', {
      servers: [{ url: '/relative' }],
      paths: { '/a': { get: { operationId: 'a', parameters: [] } } },
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('no host');
  });
});
