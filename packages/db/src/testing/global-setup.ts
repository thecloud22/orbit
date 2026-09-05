import { runMigrations } from '../migrate';
import { loadTestEnv, resolveTestDatabaseUrl } from './test-database';

/**
 * Vitest global setup for the database integration project.
 *
 * Migrations run once for the whole suite rather than per file, so every test
 * file sees the same schema and a failure to migrate stops the run immediately
 * instead of surfacing as a confusing missing-table error.
 */
export default async function setup(): Promise<void> {
  loadTestEnv();
  const url = resolveTestDatabaseUrl();
  const { databaseName } = await runMigrations(url);
  process.stdout.write(`\nIntegration schema ready in database "${databaseName}".\n`);
}
