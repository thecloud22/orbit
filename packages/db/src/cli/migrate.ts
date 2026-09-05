import { requireDatabaseUrl } from '../config';
import { runMigrations } from '../migrate';
import { loadRootEnv } from './env';

/**
 * `pnpm db:migrate`.
 *
 * Applies committed migrations to DATABASE_URL. Never prints the URL: it
 * carries a password. Reports the database name so an operator can see which
 * database was changed.
 */
loadRootEnv();

const url = requireDatabaseUrl('DATABASE_URL');
const { databaseName } = await runMigrations(url);

process.stdout.write(`Migrations applied to database "${databaseName}".\n`);
