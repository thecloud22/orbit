import { sql } from 'drizzle-orm';

import { ORBIT_TABLE_NAMES } from '../schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type OrbitDatabaseHandle } from '../client';
import { requireDatabaseUrl } from '../config';
import { UnsafeDatabaseTargetError } from '../errors';
import { seedFindServiceRequest } from '../seed';
import { useTestDatabase } from './harness';
import {
  assertTestDatabase,
  loadTestEnv,
  resolveTestDatabaseUrl,
  TestDatabaseBlockedError,
  truncateOrbitTables,
} from './test-database';

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

  /**
   * The ceiling under every other statement a test issues.
   *
   * Asserted rather than assumed, because it is carried in the connection URL:
   * a typo there would leave every test connection unbounded and nothing else
   * would notice until the next twelve-minute hang.
   */
  it('gives every test connection a bounded statement timeout', async () => {
    const shown = await testDatabase().db.execute<{ statement_timeout: string }>(
      sql`show statement_timeout`,
    );

    expect(shown.rows[0]?.statement_timeout).toBe('30s');
  });

  /**
   * The hang this reset used to cause, turned into a failure.
   *
   * `TRUNCATE` needs ACCESS EXCLUSIVE on every table it names and, by default,
   * PostgreSQL waits for that lock forever. A connection left holding row locks
   * — a dispatched run nothing waited for, a server another suite left behind —
   * therefore did not make a suite fail; it made it *stop*, until the test
   * file's own timeout expired with a message about the test rather than about
   * the lock. That is the twelve-minute failure this task exists to remove.
   *
   * A real second connection holds a real lock here, because the claim is about
   * PostgreSQL's behaviour and a stub could not make it.
   */
  it('fails fast, naming the other connections, when something holds the lock', async () => {
    const blocker = createDatabase({ url: resolveTestDatabaseUrl(), maxConnections: 1 });
    const client = await blocker.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query('LOCK TABLE agents IN ACCESS EXCLUSIVE MODE');

      const startedAt = Date.now();

      // A short bound so proving the behaviour costs a fraction of a second
      // rather than the ten the real reset allows itself.
      const thrown = await truncateOrbitTables(testDatabase().db, 'orbit_test', {
        lockTimeoutMs: 250,
      }).then(
        () => undefined,
        (error: unknown) => error,
      );

      expect(thrown).toBeInstanceOf(TestDatabaseBlockedError);
      expect(Date.now() - startedAt).toBeLessThan(5_000);

      const { message } = thrown as TestDatabaseBlockedError;

      // It has to say what happened and point at the culprit; a bare
      // "lock_not_available" would leave the same debugging session to run.
      expect(message).toContain('gave up after 250ms');
      expect(message).toContain('Other connections to this database');
      expect(message).toContain('pid ');
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await blocker.close();
    }
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
    // Derived from the schema rather than hard-coded, so adding a table is not
    // a reason to edit this assertion — only dropping one should be.
    expect(Number(tables.rows[0]?.count)).toBe(ORBIT_TABLE_NAMES.length);

    const migrations = await db.execute<{ count: string }>(
      sql`select count(*)::text as count from drizzle.__drizzle_migrations`,
    );
    expect(Number(migrations.rows[0]?.count)).toBeGreaterThanOrEqual(1);
  });
});
