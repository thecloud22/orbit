import { describe, expect, it } from 'vitest';

import type { ModelResolution } from '@orbit/model-provider';

import { summariseModelSelection, type PlatformSnapshot } from '../platform';
import { buildServer } from '../server';
import { createStubContext } from '../testing/stub-context';

function snapshot(overrides: Partial<PlatformSnapshot> = {}): PlatformSnapshot {
  return {
    api: { host: '127.0.0.1', port: 3002 },
    artifactRoot: '/srv/orbit/data/artifacts',
    model: {
      configured: true,
      family: 'anthropic',
      invocation: 'direct',
      model: 'claude-haiku-4-5',
      reason: null,
    },
    database: {
      databaseName: 'orbit',
      serverVersion: '17.4',
      migrations: {
        committed: ['0000_a', '0001_b', '0002_c'],
        applied: ['0000_a', '0001_b'],
        pending: ['0002_c'],
        unrecognised: 0,
      },
    },
    ...overrides,
  };
}

function serverReporting(value: PlatformSnapshot) {
  return buildServer({
    context: createStubContext({ platform: { describe: async () => value } }),
    logLevel: 'silent',
  });
}

describe('GET /v1/platform', () => {
  it('reports the address, artifact root, model in force and migration level', async () => {
    const app = serverReporting(snapshot());

    const response = await app.inject({ method: 'GET', url: '/v1/platform' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        api: { host: '127.0.0.1', port: 3002 },
        authentication: 'none',
        artifactRoot: '/srv/orbit/data/artifacts',
        model: {
          configured: true,
          family: 'anthropic',
          invocation: 'direct',
          model: 'claude-haiku-4-5',
          reason: null,
        },
        database: {
          name: 'orbit',
          serverVersion: '17.4',
          migrationsCommitted: 3,
          migrationsApplied: 2,
          pending: ['0002_c'],
          latestApplied: '0001_b',
          unrecognised: 0,
          current: false,
        },
      },
    });

    await app.close();
  });

  it('calls a database current when nothing is pending or unrecognised', async () => {
    const app = serverReporting(
      snapshot({
        database: {
          databaseName: 'orbit',
          serverVersion: '17.4',
          migrations: {
            committed: ['0000_a', '0001_b'],
            applied: ['0000_a', '0001_b'],
            pending: [],
            unrecognised: 0,
          },
        },
      }),
    );

    const body = response(await app.inject({ method: 'GET', url: '/v1/platform' }));

    expect(body.database.current).toBe(true);
    expect(body.database.latestApplied).toBe('0001_b');

    await app.close();
  });

  it('is not current when the database was migrated by a newer checkout', async () => {
    // Nothing pending, so a count-only check would call this healthy. It is the
    // opposite case — the working copy is behind — and no migration fixes it.
    const app = serverReporting(
      snapshot({
        database: {
          databaseName: 'orbit',
          serverVersion: '17.4',
          migrations: {
            committed: ['0000_a'],
            applied: ['0000_a'],
            pending: [],
            unrecognised: 2,
          },
        },
      }),
    );

    const body = response(await app.inject({ method: 'GET', url: '/v1/platform' }));

    expect(body.database.current).toBe(false);
    expect(body.database.unrecognised).toBe(2);

    await app.close();
  });

  it('reports an unconfigured model by naming the missing variable', async () => {
    const app = serverReporting(
      snapshot({
        model: {
          configured: false,
          family: null,
          invocation: null,
          model: null,
          reason: 'ANTHROPIC_API_KEY is not set.',
        },
      }),
    );

    const body = response(await app.inject({ method: 'GET', url: '/v1/platform' }));

    expect(body.model).toEqual({
      configured: false,
      family: null,
      invocation: null,
      model: null,
      reason: 'ANTHROPIC_API_KEY is not set.',
    });

    await app.close();
  });

  it('has no fresh database with a null latest migration', async () => {
    const app = serverReporting(
      snapshot({
        database: {
          databaseName: 'orbit',
          serverVersion: '17.4',
          migrations: { committed: ['0000_a'], applied: [], pending: ['0000_a'], unrecognised: 0 },
        },
      }),
    );

    const body = response(await app.inject({ method: 'GET', url: '/v1/platform' }));

    expect(body.database.latestApplied).toBeNull();
    expect(body.database.current).toBe(false);

    await app.close();
  });

  it('refuses to write', async () => {
    // The absence of a writer is the design, so it is asserted rather than left
    // to be inferred from the absence of a handler.
    const app = serverReporting(snapshot());

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      const rejected = await app.inject({ method, url: '/v1/platform', payload: {} });
      expect(rejected.statusCode).toBe(404);
    }

    await app.close();
  });
});

describe('summariseModelSelection', () => {
  it('keeps the three axes and drops the credential', () => {
    const resolution: ModelResolution = {
      status: 'configured',
      selection: {
        family: 'anthropic',
        invocation: 'direct',
        model: 'claude-haiku-4-5',
        apiKey: 'sk-must-never-be-published',
      },
      deprecations: [],
    };

    const summary = summariseModelSelection(resolution);

    expect(summary).toEqual({
      configured: true,
      family: 'anthropic',
      invocation: 'direct',
      model: 'claude-haiku-4-5',
      reason: null,
    });
    expect(JSON.stringify(summary)).not.toContain('sk-must-never-be-published');
  });

  it('drops a Bedrock region too, because the page does not need it', () => {
    const summary = summariseModelSelection({
      status: 'configured',
      selection: {
        family: 'anthropic',
        invocation: 'bedrock',
        model: 'anthropic.claude-haiku-4-5',
        region: 'eu-west-1',
      },
      deprecations: [],
    });

    expect(JSON.stringify(summary)).not.toContain('eu-west-1');
    expect(summary.invocation).toBe('bedrock');
  });

  it('carries an unconfigured reason through unchanged', () => {
    expect(
      summariseModelSelection({
        status: 'unconfigured',
        reason: 'GEMINI_API_KEY is not set.',
        deprecations: [],
      }),
    ).toEqual({
      configured: false,
      family: null,
      invocation: null,
      model: null,
      reason: 'GEMINI_API_KEY is not set.',
    });
  });
});

/**
 * A published secret would still be a passing test if the assertion only looked
 * at the fields it expected, so the whole body is checked for a credential the
 * fixture deliberately puts one character away from the wire.
 */
describe('the platform response body', () => {
  it('never carries an API key, even when one is in the resolution', async () => {
    const resolved = summariseModelSelection({
      status: 'configured',
      selection: {
        family: 'anthropic',
        invocation: 'direct',
        model: 'claude-haiku-4-5',
        apiKey: 'sk-leak-canary',
        region: 'us-east-1',
      },
      deprecations: [],
    });

    const app = serverReporting(snapshot({ model: resolved }));
    const raw = (await app.inject({ method: 'GET', url: '/v1/platform' })).body;

    expect(raw).not.toContain('sk-leak-canary');
    expect(raw).not.toContain('us-east-1');
    expect(raw).toContain('claude-haiku-4-5');

    await app.close();
  });
});

function response(injected: { json(): unknown }): {
  readonly model: unknown;
  readonly database: {
    readonly current: boolean;
    readonly latestApplied: string | null;
    readonly unrecognised: number;
  };
} {
  return (injected.json() as { data: never }).data;
}
