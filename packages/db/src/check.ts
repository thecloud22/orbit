import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { createDatabase, type Executor } from './client';
import { databaseNameFromUrl } from './config';
import { MIGRATIONS_FOLDER } from './migrate';

/**
 * Non-destructive inspection of a database Orbit owns.
 *
 * Bootstrap and smoke tooling need to answer two questions before doing
 * anything else — "can I reach this database?" and "is its schema current?" —
 * and both must be answerable without changing a single row. Everything here
 * issues `select` statements only. Nothing creates, drops, truncates or
 * migrates; applying migrations stays in `runMigrations`, where it is the
 * caller's explicit choice.
 *
 * No function here ever returns or logs a connection URL. A URL carries a
 * password, so callers get a database name and nothing else.
 */

/** Drizzle's own bookkeeping table, written by the migrator and read here. */
const MIGRATIONS_TABLE = 'drizzle.__drizzle_migrations';

/**
 * The committed migration list, as Drizzle Kit records it.
 *
 * `when` is the identity that matters: the migrator writes it to
 * `created_at` when it applies a migration, so matching the two is how an
 * applied row is mapped back to the file it came from.
 */
const migrationJournalSchema = z.object({
  entries: z.array(
    z.object({
      idx: z.number().int(),
      when: z.number().int(),
      tag: z.string().min(1),
    }),
  ),
});

export type MigrationJournalEntry = z.output<typeof migrationJournalSchema>['entries'][number];

export interface MigrationLevel {
  /** Migration tags committed to this checkout, in journal order. */
  readonly committed: readonly string[];
  /** Committed tags this database has already had applied. */
  readonly applied: readonly string[];
  /** Committed tags this database is missing. */
  readonly pending: readonly string[];
  /**
   * Applied rows that match no committed migration.
   *
   * A database migrated by a *newer* checkout than the one running. Reported
   * rather than ignored, because it is the shape of "your working copy is
   * behind the database" and no migration command will fix it.
   */
  readonly unrecognised: number;
}

/** True when the schema in this checkout has been fully applied. */
export function isMigrationLevelCurrent(level: MigrationLevel): boolean {
  return level.pending.length === 0 && level.unrecognised === 0;
}

/**
 * Matches applied timestamps against the committed journal.
 *
 * Pure, so the interesting cases — a fresh database, a partly migrated one, a
 * checkout older than its database — are testable without PostgreSQL.
 */
export function migrationLevel(
  entries: readonly MigrationJournalEntry[],
  appliedTimestamps: readonly number[],
): MigrationLevel {
  const ordered = [...entries].sort((left, right) => left.idx - right.idx);
  const applied = new Set(appliedTimestamps);
  const known = new Set(ordered.map((entry) => entry.when));

  return {
    committed: ordered.map((entry) => entry.tag),
    applied: ordered.filter((entry) => applied.has(entry.when)).map((entry) => entry.tag),
    pending: ordered.filter((entry) => !applied.has(entry.when)).map((entry) => entry.tag),
    unrecognised: appliedTimestamps.filter((stamp) => !known.has(stamp)).length,
  };
}

/** Reads the committed migration journal from the migrations folder. */
export function readMigrationJournal(
  folder: string = MIGRATIONS_FOLDER,
): readonly MigrationJournalEntry[] {
  const raw = readFileSync(join(folder, 'meta', '_journal.json'), 'utf8');
  return migrationJournalSchema.parse(JSON.parse(raw)).entries;
}

/**
 * Reads the timestamps of every applied migration.
 *
 * A database that has never been migrated has no bookkeeping table at all, and
 * that is an ordinary answer rather than an error, so the table's existence is
 * checked before it is queried.
 */
export async function appliedMigrationTimestamps(executor: Executor): Promise<readonly number[]> {
  const present = await executor.execute<{ table_name: string | null }>(
    sql`select to_regclass(${MIGRATIONS_TABLE})::text as table_name`,
  );

  if (present.rows[0]?.table_name == null) {
    return [];
  }

  const rows = await executor.execute<{ created_at: string | number | null }>(
    sql`select created_at from drizzle.__drizzle_migrations order by created_at asc`,
  );

  return rows.rows
    .map((row) => Number(row.created_at))
    .filter((value) => Number.isFinite(value) && value !== 0);
}

export interface DatabaseCheck {
  readonly databaseName: string;
  readonly serverVersion: string;
  readonly migrations: MigrationLevel;
}

/**
 * Connects, reports what it found, and disconnects.
 *
 * The connection is asked which database it is actually attached to rather than
 * trusting the URL's path, for the same reason the test harness does: a URL can
 * be overridden by PG* variables, a service file, or a pooler.
 */
export async function checkDatabase(
  url: string,
  options: { readonly migrationsFolder?: string } = {},
): Promise<DatabaseCheck> {
  const handle = createDatabase({ url, maxConnections: 1 });

  try {
    const identity = await handle.db.execute<{ name: string; version: string }>(
      sql`select current_database() as name, current_setting('server_version') as version`,
    );

    const row = identity.rows[0];
    const timestamps = await appliedMigrationTimestamps(handle.db);
    const journal = readMigrationJournal(options.migrationsFolder ?? MIGRATIONS_FOLDER);

    return {
      databaseName: row?.name ?? databaseNameFromUrl(url),
      serverVersion: row?.version ?? 'unknown',
      migrations: migrationLevel(journal, timestamps),
    };
  } finally {
    await handle.close();
  }
}
