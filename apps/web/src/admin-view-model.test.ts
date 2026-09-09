import { describe, expect, it } from 'vitest';

import type { PlatformDatabaseView, PlatformModelView, PlatformView } from '@orbit/api/views';

import { describeMigrations, describeModel, platformFacts } from './admin-view-model';

function database(overrides: Partial<PlatformDatabaseView> = {}): PlatformDatabaseView {
  return {
    name: 'orbit',
    serverVersion: '17.4',
    migrationsCommitted: 11,
    migrationsApplied: 11,
    pending: [],
    latestApplied: '0010_proposals_from_demonstration',
    unrecognised: 0,
    current: true,
    ...overrides,
  };
}

function model(overrides: Partial<PlatformModelView> = {}): PlatformModelView {
  return {
    configured: true,
    family: 'anthropic',
    invocation: 'direct',
    model: 'claude-haiku-4-5',
    reason: null,
    ...overrides,
  };
}

describe('describeMigrations', () => {
  it('calls a fully applied schema current, with nothing to run', () => {
    const status = describeMigrations(database());

    expect(status.tone).toBe('current');
    expect(status.action).toBeNull();
    expect(status.appliedLabel).toBe('11 of 11 committed migrations applied');
  });

  it('names the pending migrations and the command that applies them', () => {
    const status = describeMigrations(
      database({
        migrationsApplied: 9,
        pending: ['0009_a', '0010_b'],
        current: false,
      }),
    );

    expect(status.tone).toBe('behind');
    expect(status.headline).toContain('0009_a, 0010_b');
    expect(status.action).toBe('pnpm db:migrate');
  });

  it('uses the singular for one pending migration', () => {
    const status = describeMigrations(
      database({ migrationsApplied: 10, pending: ['0010_b'], current: false }),
    );

    expect(status.headline).toContain('1 committed migration has not been applied');
  });

  it('offers no command when the database is ahead of the checkout', () => {
    // Nothing is pending, so the naive reading is "healthy". It is the opposite
    // problem, and `pnpm db:migrate` cannot fix it.
    const status = describeMigrations(database({ unrecognised: 2, current: false }));

    expect(status.tone).toBe('ahead');
    expect(status.headline).toContain('newer version of Orbit');
    expect(status.action).toBeNull();
  });

  it('reports being ahead even when migrations are also pending', () => {
    const status = describeMigrations(
      database({ migrationsApplied: 9, pending: ['0010_b'], unrecognised: 1, current: false }),
    );

    expect(status.tone).toBe('ahead');
    expect(status.action).toBeNull();
  });
});

describe('describeModel', () => {
  it('names the family and model, and says it is reached directly', () => {
    const status = describeModel(model());

    expect(status.configured).toBe(true);
    expect(status.headline).toBe('anthropic · claude-haiku-4-5');
    expect(status.detail).toContain('directly');
  });

  it('says when a model is reached through Bedrock', () => {
    expect(describeModel(model({ invocation: 'bedrock' })).detail).toContain('Bedrock');
  });

  it('treats an unconfigured deployment as a working one, not an outage', () => {
    const status = describeModel({
      configured: false,
      family: null,
      invocation: null,
      model: null,
      reason: 'ANTHROPIC_API_KEY is not set.',
    });

    expect(status.configured).toBe(false);
    expect(status.detail).toContain('ANTHROPIC_API_KEY is not set.');
    expect(status.detail).toContain('everything else works');
  });

  it('still explains itself when no reason was reported', () => {
    const status = describeModel({
      configured: false,
      family: null,
      invocation: null,
      model: null,
      reason: null,
    });

    expect(status.headline).toBe('No model is configured.');
    expect(status.detail).toContain('Recording, binding, publishing and running need no model.');
  });
});

describe('platformFacts', () => {
  const platform: PlatformView = {
    api: { host: '127.0.0.1', port: 3002 },
    authentication: 'none',
    artifactRoot: '/srv/orbit/data/artifacts',
    model: model(),
    database: database(),
    orphanedRuns: [],
  };

  it('reports the address, artifact root, database and orphaned runs', () => {
    expect(platformFacts(platform).map((fact) => fact.id)).toEqual([
      'api-address',
      'artifact-root',
      'database-name',
      'orphaned-runs',
    ]);
  });

  it('shows the address the API actually bound', () => {
    const address = platformFacts(platform).find((fact) => fact.id === 'api-address');

    expect(address?.value).toBe('127.0.0.1:3002');
  });

  it('reports no orphaned runs plainly rather than an empty-looking value', () => {
    const orphans = platformFacts(platform).find((fact) => fact.id === 'orphaned-runs');

    expect(orphans?.value).toBe('None');
  });

  it('names an orphaned run by id', () => {
    const orphans = platformFacts({
      ...platform,
      orphanedRuns: [{ runId: 'run_orphan', status: 'running', queuedAt: '2026-09-09T00:00:00Z' }],
    }).find((fact) => fact.id === 'orphaned-runs');

    expect(orphans?.value).toContain('run_orphan');
    expect(orphans?.value).toContain('1');
  });

  it('never repeats the model, which has its own section', () => {
    const serialized = JSON.stringify(platformFacts(platform));

    expect(serialized).not.toContain('claude-haiku-4-5');
  });
});
