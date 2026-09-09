import { newAgentVersionId } from '@orbit/contracts';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { ImmutableAgentVersionError, isUniqueViolation, violatedConstraint } from '../errors';
import { ORBIT_TABLE_NAMES } from '../schema';
import { seedFindServiceRequest, readFindServiceRequestFixture } from '../seed';
import { useTestDatabase } from '../testing/harness';
import { createRepositories } from './index';

const testDatabase = useTestDatabase();

describe('migrations', () => {
  it('creates every Orbit table in the test database', async () => {
    const { rows } = await testDatabase().db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const names = new Set(rows.map((row) => row.table_name));

    for (const table of ORBIT_TABLE_NAMES) {
      expect(names.has(table)).toBe(true);
    }
  });

  it('records the applied migration, so re-running applies nothing', async () => {
    const { rows } = await testDatabase().db.execute<{ count: string }>(
      sql`select count(*)::text as count from drizzle.__drizzle_migrations`,
    );

    expect(Number(rows[0]?.count)).toBeGreaterThanOrEqual(1);
  });
});

describe('agents', () => {
  it('creates and retrieves an agent by its opaque id', async () => {
    const repositories = createRepositories(testDatabase().db);

    const created = await repositories.agents.create({
      id: 'agent_find_service_request' as never,
      name: 'Find Service Request',
      description: 'Locate a service request.',
    });

    const found = await repositories.agents.findById(created.id);

    expect(found?.id).toBe('agent_find_service_request');
    expect(found?.name).toBe('Find Service Request');
    expect(found?.description).toBe('Locate a service request.');
  });

  it('returns null rather than throwing for an unknown agent', async () => {
    const repositories = createRepositories(testDatabase().db);
    expect(await repositories.agents.findById('agent_missing' as never)).toBeNull();
  });

  it('archives and restores an agent without touching its name or description', async () => {
    const repositories = createRepositories(testDatabase().db);
    const created = await repositories.agents.create({
      id: 'agent_to_archive' as never,
      name: 'Retiring Soon',
    });
    expect(created.archivedAt).toBeNull();

    const archived = await repositories.agents.archive(created.id);
    expect(archived?.archivedAt).not.toBeNull();
    expect(archived?.name).toBe('Retiring Soon');

    const restored = await repositories.agents.restore(created.id);
    expect(restored?.archivedAt).toBeNull();
    expect(restored?.name).toBe('Retiring Soon');
  });

  it('returns null archiving or restoring an agent that does not exist', async () => {
    const repositories = createRepositories(testDatabase().db);
    expect(await repositories.agents.archive('agent_missing' as never)).toBeNull();
    expect(await repositories.agents.restore('agent_missing' as never)).toBeNull();
  });
});

describe('seeding find service request 0.1.0', () => {
  it('seeds the agent and its version from the validated fixture', async () => {
    const { db } = testDatabase();
    const { agentVersion, created } = await seedFindServiceRequest(db);

    expect(created).toBe(true);
    expect(agentVersion.id).toBe('agentv_find_service_request_0_1_0');
    expect(agentVersion.agentId).toBe('agent_find_service_request');
    expect(agentVersion.version).toBe('0.1.0');
    expect(agentVersion.lifecycleStatus).toBe('published');
    expect(agentVersion.trustTier).toBe('observe');
    expect(agentVersion.sourceSopId).toBe('sop_find_service_request');
    expect(agentVersion.irSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(agentVersion.publishedAt).not.toBeNull();

    const agent = await createRepositories(db).agents.findById(agentVersion.agentId);
    expect(agent?.name).toBe('Find Service Request');
  });

  it('is idempotent: re-seeding an unchanged fixture creates nothing new', async () => {
    const { db } = testDatabase();

    const first = await seedFindServiceRequest(db);
    const second = await seedFindServiceRequest(db);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.agentVersion.id).toBe(first.agentVersion.id);
    expect(second.agentVersion.irSha256).toBe(first.agentVersion.irSha256);

    const versions = await createRepositories(db).agentVersions.listByAgent(
      first.agentVersion.agentId,
    );
    expect(versions).toHaveLength(1);
  });

  it('refuses to overwrite a published version whose IR has changed', async () => {
    const { db } = testDatabase();
    await seedFindServiceRequest(db);

    // Same version number, different content: publishing a change means a new
    // version, never an edit to the one historical runs already reference.
    const altered = readFindServiceRequestFixture().replace(
      'name: Find Service Request',
      'name: Find Service Request (edited)',
    );

    await expect(seedFindServiceRequest(db, { fixtureYaml: altered })).rejects.toThrow(
      ImmutableAgentVersionError,
    );

    const stored = await createRepositories(db).agentVersions.findById(
      'agentv_find_service_request_0_1_0' as never,
    );
    expect(stored?.name).toBe('Find Service Request');
  });

  it('refuses to seed Agent IR that does not validate', async () => {
    const invalid = readFindServiceRequestFixture().replace(
      'type: browser.click',
      'type: browser.hover',
    );

    await expect(
      seedFindServiceRequest(testDatabase().db, { fixtureYaml: invalid }),
    ).rejects.toThrow(/Refusing to seed invalid Agent IR/);
  });
});

describe('agent version immutability and integrity', () => {
  it('exposes no mutation path for published Agent IR', () => {
    const { agentVersions } = createRepositories(testDatabase().db);
    const methods = Object.keys(agentVersions);

    expect(methods).not.toContain('update');
    expect(methods).not.toContain('publish');
    expect(methods).not.toContain('delete');
    // Pinned exactly, so widening this surface is a deliberate edit rather
    // than something that happens on the way to a feature. Every entry beyond
    // `create` is a read.
    expect(methods.sort()).toEqual([
      'create',
      'findByAgentAndVersion',
      'findById',
      'listByAgent',
      'listPublished',
      'publishedByDocument',
    ]);
  });

  it('rejects a second version row with the same agent and version string', async () => {
    const { db } = testDatabase();
    const { agentVersion } = await seedFindServiceRequest(db);
    const repositories = createRepositories(db);

    const original = await repositories.agentVersions.findById(agentVersion.id);

    const error = await repositories.agentVersions
      .create({ agentIr: original!.agentIr, id: newAgentVersionId() })
      .catch((caught: unknown) => caught);

    expect(isUniqueViolation(error)).toBe(true);
    expect(violatedConstraint(error)).toBe('agent_versions_agent_id_version_unique');
  });

  it('detects an out-of-band edit to the stored IR through the checksum', async () => {
    const { db } = testDatabase();
    const { agentVersion } = await seedFindServiceRequest(db);

    // Simulates a stray psql session; the repository offers no way to do this.
    await db.execute(
      sql`update agent_versions set agent_ir = jsonb_set(agent_ir, '{name}', '"Tampered"') where id = ${agentVersion.id}`,
    );

    await expect(createRepositories(db).agentVersions.findById(agentVersion.id)).rejects.toThrow(
      /checksum mismatch/,
    );
  });
});

describe('agent ir round trip through jsonb', () => {
  it('still validates as Agent IR when read back', async () => {
    const { db } = testDatabase();
    const { agentVersion } = await seedFindServiceRequest(db);

    const loaded = await createRepositories(db).agentVersions.findById(agentVersion.id);
    const ir = loaded!.agentIr;

    expect(ir.steps).toHaveLength(8);
    expect(ir.steps[0]?.id).toBe('open_request_portal');
    expect(ir.permissions.browser?.allowedDomains).toEqual(['localhost']);
    expect(ir.source.sourceSopStepIds).toEqual([
      'sop_step_open_portal',
      'sop_step_search_and_verify',
    ]);
    expect(Object.keys(ir.inputs)).toEqual(['requestNumber']);
    expect(ir.inputs['requestNumber']?.required).toBe(true);
  });

  it('lists the seeded version for Watchtower with its input schema', async () => {
    const { db } = testDatabase();
    await seedFindServiceRequest(db);

    const [summary, ...rest] = await createRepositories(db).agentVersions.listPublished();

    expect(rest).toHaveLength(0);
    expect(summary?.name).toBe('Find Service Request');
    expect(summary?.version).toBe('0.1.0');
    expect(summary?.inputs['requestNumber']?.label).toBe('Service request number');
  });

  it('excludes a published version once its agent is archived, and includes it again once restored', async () => {
    const { db } = testDatabase();
    const { agentVersion } = await seedFindServiceRequest(db);
    const repositories = createRepositories(db);

    // Archiving retires the agent identity, never the version row (ADR-026):
    // this is the one place that distinction is actually observable.
    await repositories.agents.archive(agentVersion.agentId);
    expect(await repositories.agentVersions.listPublished()).toEqual([]);

    const stillThere = await repositories.agentVersions.findById(agentVersion.id);
    expect(stillThere?.lifecycleStatus).toBe('published');
    expect(stillThere?.irSha256).toBe(agentVersion.irSha256);

    await repositories.agents.restore(agentVersion.agentId);
    const [summary] = await repositories.agentVersions.listPublished();
    expect(summary?.id).toBe(agentVersion.id);
  });
});
