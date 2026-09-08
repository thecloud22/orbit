import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';

import { createDatabase, type Executor, type OrbitDatabaseHandle } from '../client';
import { databaseNameFromUrl, requireDatabaseUrl } from '../config';
import { isLockNotAvailable, OrbitDatabaseError, UnsafeDatabaseTargetError } from '../errors';
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

/**
 * How long a reset waits for its exclusive lock before failing with a name.
 *
 * `TRUNCATE` needs ACCESS EXCLUSIVE on every table it names, and PostgreSQL
 * waits for that lock indefinitely by default. A leftover connection still
 * holding row locks — a run this process dispatched and did not wait for, an
 * API left over from another suite — therefore does not make the reset *fail*;
 * it makes it *block*, invisibly, until the test file's own timeout expires
 * with a message about the test rather than about the lock. Ten seconds is far
 * longer than an uncontended reset needs (~46ms measured) and far shorter than
 * any suite timeout. Overridable per call, which only the test that proves this
 * behaviour uses, so proving it costs a fraction of a second rather than ten.
 */
export const TRUNCATE_LOCK_TIMEOUT_MS = 10_000;

/**
 * A ceiling on every other statement a test issues.
 *
 * Same failure to avoid, one level out: any query can wait on a lock forever,
 * and a test blocked in the driver is a test whose own timeout reports the
 * wrong thing. Generous enough that no legitimate test statement approaches it.
 */
const TEST_STATEMENT_TIMEOUT_MS = 30_000;

/** A destructive reset could not get its lock, because something else holds it. */
export class TestDatabaseBlockedError extends OrbitDatabaseError {}

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
  options: { readonly lockTimeoutMs?: number } = {},
): Promise<void> {
  const lockTimeoutMs = options.lockTimeoutMs ?? TRUNCATE_LOCK_TIMEOUT_MS;

  await assertTestDatabase(executor, expectedDatabaseName);

  // Safe to inline: ORBIT_TABLE_NAMES is a compile-time constant, never input.
  const tableList = ORBIT_TABLE_NAMES.map((name) => `"${name}"`).join(', ');

  try {
    // In a transaction because `SET LOCAL` is the only form that is guaranteed
    // to apply to the statement that follows it: the pool hands out whichever
    // connection is free, so a session-level `SET` may land on a connection
    // that never runs the truncate.
    await executor.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL lock_timeout = ${lockTimeoutMs}`));
      await tx.execute(sql.raw(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`));
    });
  } catch (error) {
    if (!isLockNotAvailable(error)) {
      throw error;
    }

    throw new TestDatabaseBlockedError(
      await blockedResetMessage(executor, expectedDatabaseName, lockTimeoutMs),
      { cause: error },
    );
  }
}

/**
 * Explains a blocked reset by naming the other connections, not by guessing.
 *
 * The point is to answer the only question worth asking at that moment — what
 * else is attached to this database — with enough to act on: a pid to look up
 * with `ps`, and how long it has been sitting there. Deliberately *not* the
 * `query` column: a statement's text carries row data, and this message goes
 * straight to test output.
 */
async function blockedResetMessage(
  executor: Executor,
  databaseName: string,
  lockTimeoutMs: number,
): Promise<string> {
  const lines = [
    `Resetting "${databaseName}" gave up after ${lockTimeoutMs}ms waiting for its lock.`,
    '',
    'Something else is still attached to the test database and holding locks on',
    'its tables. Usually that is a run dispatched by an earlier test that nothing',
    'waited for, or a server left behind by another suite.',
  ];

  try {
    const result = await executor.execute<{
      pid: number;
      application_name: string;
      state: string | null;
      seconds: number;
    }>(sql`
      select pid,
             application_name,
             state,
             round(extract(epoch from (now() - coalesce(xact_start, state_change, backend_start))))::int as seconds
        from pg_stat_activity
       where datname = current_database()
         and pid <> pg_backend_pid()
       order by pid
    `);

    if (result.rows.length > 0) {
      lines.push('', 'Other connections to this database:');

      for (const row of result.rows) {
        const name = row.application_name === '' ? '(unnamed)' : row.application_name;
        lines.push(`  - pid ${row.pid}, ${name}, ${row.state ?? 'unknown'} for ${row.seconds}s`);
      }
    }
  } catch {
    lines.push('', '(Could not list the other connections; the database is not answering either.)');
  }

  return lines.join('\n');
}

/**
 * Adds the statement ceiling to a connection URL.
 *
 * Carried in the startup packet rather than issued as a `SET` on each new
 * pooled connection. Both work, but the `SET` has to be queued behind the
 * consumer's first query on that client, which `pg` now warns about and will
 * refuse at 9.0 — and a deprecation warning per test file is noise in exactly
 * the failure logs this task is trying to make readable. The server applying it
 * at connection time also covers the first statement, which the queued form
 * does not.
 */
function withStatementTimeout(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('options', `-c statement_timeout=${TEST_STATEMENT_TIMEOUT_MS}`);
  return parsed.toString();
}

/** Connects to the guarded test database and applies migrations. */
export async function createTestDatabase(
  env: NodeJS.ProcessEnv = process.env,
): Promise<OrbitTestDatabase> {
  const url = resolveTestDatabaseUrl(env);
  const databaseName = databaseNameFromUrl(url);

  await runMigrations(url);

  // Migrations connect on the plain URL: a schema change is legitimately the
  // one slow statement here, and bounding it would be bounding the wrong thing.
  const handle = createDatabase({ url: withStatementTimeout(url), maxConnections: 5 });

  await assertTestDatabase(handle.db, databaseName);

  return {
    ...handle,
    databaseName,
    truncate: () => truncateOrbitTables(handle.db, databaseName),
  };
}
