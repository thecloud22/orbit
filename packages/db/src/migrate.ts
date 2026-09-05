import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { createDatabase } from './client';
import { databaseNameFromUrl } from './config';

/** Committed migration SQL lives beside the package, not beside the caller. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

export interface MigrationResult {
  readonly databaseName: string;
}

/**
 * Applies every pending migration to the database the URL points at.
 *
 * The URL is passed in rather than read from the environment here, so the same
 * function serves `pnpm db:migrate` against DATABASE_URL and the integration
 * harness against TEST_DATABASE_URL, with no chance of one silently using the
 * other's connection.
 */
export async function runMigrations(url: string): Promise<MigrationResult> {
  const handle = createDatabase({ url, maxConnections: 1 });

  try {
    await migrate(handle.db, { migrationsFolder: MIGRATIONS_FOLDER });
    return { databaseName: databaseNameFromUrl(url) };
  } finally {
    await handle.close();
  }
}
