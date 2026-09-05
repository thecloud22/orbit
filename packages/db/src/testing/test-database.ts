import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';

import { createDatabase, type Executor, type OrbitDatabaseHandle } from '../client';
import { databaseNameFromUrl, requireDatabaseUrl } from '../config';
import { UnsafeDatabaseTargetError } from '../errors';
import { runMigrations } from '../migrate';
import { ORBIT_TABLE_NAMES } from '../schema';

/**
 * Test-database plumbing.
 *
 * Everything here is destructive, so every entry point is guarded. The one rule
 * that matters: an Orbit test must never be able to truncate the development
 * database. That is enforced three ways — TEST_DATABASE_URL is required and
 * never falls back to DATABASE_URL, the two URLs must name different databases,
 * and the live connection is asked `current_database()` immediately before any
 * truncate.
 */

const TEST_DATABASE_SUFFIX = '_test';

export function loadTestEnv(): void {
  const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));

  try {
    process.loadEnvFile(envPath);
  } catch {
    // Already-exported variables are fine; CI supplies its own.
  }
}

/**
 * Resolves the test connection URL, refusing every unsafe shape.
 *
 * There is deliberately no fallback to DATABASE_URL. A missing variable fails
 * the run; it never quietly points destructive tests at development data.
 */
export function resolveTestDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = requireDatabaseUrl('TEST_DATABASE_URL', env);
  const name = databaseNameFromUrl(url);

  if (!name.endsWith(TEST_DATABASE_SUFFIX)) {
    throw new UnsafeDatabaseTargetError(
      `TEST_DATABASE_URL points at database "${name}", which does not end in "${TEST_DATABASE_SUFFIX}". Integration tests truncate every Orbit table, so they refuse to run against it.`,
    );
  }

  const developmentUrl = env['DATABASE_URL'];

  if (developmentUrl !== undefined && developmentUrl.trim() !== '') {
    const developmentName = databaseNameFromUrl(developmentUrl.trim());

    if (developmentName === name) {
      throw new UnsafeDatabaseTargetError(
        `TEST_DATABASE_URL and DATABASE_URL both point at database "${name}". The test database must be separate from the development database.`,
      );
    }
  }

  return url;
}

/**
 * Asks the live connection which database it is actually attached to.
 *
 * A URL can lie — a connection string may be overridden by PG* environment
 * variables, a service file, or a pooler. This is the check that runs
 * immediately before anything destructive.
 */
export async function assertTestDatabase(
  executor: Executor,
  expectedName: string,
): Promise<string> {
  const result = await executor.execute<{ current_database: string }>(
    sql`select current_database()`,
  );
  const actual = result.rows[0]?.current_database;

  if (actual === undefined) {
    throw new UnsafeDatabaseTargetError('Could not determine the connected database name.');
  }

  if (!actual.endsWith(TEST_DATABASE_SUFFIX) || actual !== expectedName) {
    throw new UnsafeDatabaseTargetError(
      `Refusing to modify database "${actual}": destructive test operations are only permitted against "${expectedName}".`,
    );
  }

  return actual;
}

export interface OrbitTestDatabase extends OrbitDatabaseHandle {
  readonly databaseName: string;
  /** Empties every Orbit-owned table. Never drops schemas, tables, or databases. */
  truncate(): Promise<void>;
}

/**
 * Truncates only the tables Orbit owns, named explicitly.
 *
 * The list is a constant in the schema module, not a query over
 * `information_schema`: a dynamic "everything in this schema" reset would
 * happily destroy tables belonging to something else that happens to share the
 * database. Drizzle's migration bookkeeping is untouched, so the schema
 * survives and only rows are removed.
 */
export async function truncateOrbitTables(
  executor: Executor,
  expectedDatabaseName: string,
): Promise<void> {
  await assertTestDatabase(executor, expectedDatabaseName);

  // Safe to inline: ORBIT_TABLE_NAMES is a compile-time constant, never input.
  const tableList = ORBIT_TABLE_NAMES.map((name) => `"${name}"`).join(', ');
  await executor.execute(sql.raw(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`));
}

/** Connects to the guarded test database and applies migrations. */
export async function createTestDatabase(
  env: NodeJS.ProcessEnv = process.env,
): Promise<OrbitTestDatabase> {
  const url = resolveTestDatabaseUrl(env);
  const databaseName = databaseNameFromUrl(url);

  await runMigrations(url);

  const handle = createDatabase({ url, maxConnections: 5 });
  await assertTestDatabase(handle.db, databaseName);

  return {
    ...handle,
    databaseName,
    truncate: () => truncateOrbitTables(handle.db, databaseName),
  };
}
