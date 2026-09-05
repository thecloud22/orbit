import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type OrbitDatabaseHandle } from '../client';
import { requireDatabaseUrl } from '../config';
import { UnsafeDatabaseTargetError } from '../errors';
import { seedFindServiceRequest } from '../seed';
import { useTestDatabase } from './harness';
import { assertTestDatabase, loadTestEnv, truncateOrbitTables } from './test-database';

const testDatabase = useTestDatabase();

/**
 * The integration suite empties every Orbit table between tests. This file is
 * the proof that it can only ever do so to the test database.
 *
 * It connects to the development database deliberately — read-only apart from
 * the idempotent seed, which is exactly what `pnpm db:seed` does — and shows
 * that a full reset cycle against `orbit_test` leaves it untouched.
 */
describe('destructive reset safety', () => {
  let development: OrbitDatabaseHandle | undefined;

  beforeAll(async () => {
    loadTestEnv();
    development = createDatabase({ url: requireDatabaseUrl('DATABASE_URL'), maxConnections: 1 });
    // Idempotent: creates the seeded version if this developer has not run
    // `pnpm db:seed`, and changes nothing if they have.
    await seedFindServiceRequest(development.db);
  });

  afterAll(async () => {
    await development?.close();
    development = undefined;
  });

  it('refuses to truncate the development database', async () => {
    const { db } = development!;

    await expect(assertTestDatabase(db, 'orbit_test')).rejects.toThrow(UnsafeDatabaseTargetError);
    await expect(truncateOrbitTables(db, 'orbit_test')).rejects.toThrow(UnsafeDatabaseTargetError);
    // Even naming the development database as the expectation is refused: the
    // name must end in _test.
    await expect(truncateOrbitTables(db, 'orbit_dev')).rejects.toThrow(UnsafeDatabaseTargetError);
  });

  it('leaves development data intact across a full test reset cycle', async () => {
    const { db } = development!;

    const before = await db.execute<{ count: string }>(
      sql`select count(*)::text as count from agent_versions`,
    );
    const seededVersions = Number(before.rows[0]?.count);
    expect(seededVersions).toBeGreaterThan(0);

    // The same operation the suite performs between every test.
    await testDatabase().truncate();

    const after = await db.execute<{ count: string }>(
      sql`select count(*)::text as count from agent_versions`,
    );
    expect(Number(after.rows[0]?.count)).toBe(seededVersions);

    const seeded = await db.execute<{ id: string }>(
      sql`select id from agent_versions where id = 'agentv_find_service_request_0_1_0'`,
    );
    expect(seeded.rows).toHaveLength(1);
  });

  it('confirms the two databases really are different', async () => {
    const developmentName = await development!.db.execute<{ current_database: string }>(
      sql`select current_database()`,
    );

    expect(developmentName.rows[0]?.current_database).toBe('orbit_dev');
    expect(testDatabase().databaseName).toBe('orbit_test');
  });

  it('truncates only Orbit-owned tables, leaving the schema and migration history', async () => {
    const { db } = testDatabase();

    await seedFindServiceRequest(db);
    await testDatabase().truncate();

    const agents = await db.execute<{ count: string }>(
      sql`select count(*)::text as count from agents`,
    );
    expect(Number(agents.rows[0]?.count)).toBe(0);

    // The tables and the migration bookkeeping survive: reset empties rows, it
    // never drops schemas, tables, or databases.
    const tables = await db.execute<{ count: string }>(
      sql`select count(*)::text as count from information_schema.tables where table_schema = 'public'`,
    );
    expect(Number(tables.rows[0]?.count)).toBe(7);

    const migrations = await db.execute<{ count: string }>(
      sql`select count(*)::text as count from drizzle.__drizzle_migrations`,
    );
    expect(Number(migrations.rows[0]?.count)).toBeGreaterThanOrEqual(1);
  });
});
