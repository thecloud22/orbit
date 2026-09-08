import { parseArgs } from 'node:util';

import { checkDatabase, isMigrationLevelCurrent } from '../check';
import { requireDatabaseUrl } from '../config';
import { loadRootEnv } from './env';

/**
 * `pnpm db:check`.
 *
 * Answers "can Orbit reach this database, and is its schema current?" without
 * changing anything. Read-only by construction: it issues `select` statements
 * and applies nothing. `pnpm db:migrate` remains the only thing that writes
 * schema, and it stays a separate, deliberate command.
 *
 * Never prints a connection URL — it carries a password. Output names the
 * database, the server version, and the migration level.
 */

const USAGE = `
Usage: pnpm db:check [options]

  --test               Check TEST_DATABASE_URL instead of DATABASE_URL.
  --require-current    Exit non-zero when migrations are pending.
  --help               Show this message.

Read-only. It never applies a migration, seeds, or writes a row.
`.trimStart();

loadRootEnv();

const argv = process.argv.slice(2);

const { values } = parseArgs({
  args: argv[0] === '--' ? argv.slice(1) : argv,
  options: {
    test: { type: 'boolean', default: false },
    'require-current': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  allowPositionals: false,
});

if (values.help === true) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const variableName = values.test === true ? 'TEST_DATABASE_URL' : 'DATABASE_URL';
const url = requireDatabaseUrl(variableName);

let check;

try {
  check = await checkDatabase(url);
} catch (error) {
  // The message is passed through but the URL never is: a failure to connect
  // must not be the thing that prints a password into a terminal or a log.
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Could not connect using ${variableName}: ${detail}\n`);
  process.stderr.write(
    'Check that the PostgreSQL server is running and that the role and database exist.\n' +
      'See docs/guides/installation.md > Create the database role and databases.\n',
  );
  process.exit(1);
}

const { databaseName, serverVersion, migrations } = check;

process.stdout.write(
  `Connected to database "${databaseName}" (PostgreSQL ${serverVersion}) using ${variableName}.\n`,
);
process.stdout.write(
  `Migrations: ${migrations.applied.length} of ${migrations.committed.length} applied.\n`,
);

if (migrations.pending.length > 0) {
  process.stdout.write(`Pending: ${migrations.pending.join(', ')}\n`);
  process.stdout.write('Apply them with `pnpm db:migrate`.\n');
}

if (migrations.unrecognised > 0) {
  process.stdout.write(
    `${migrations.unrecognised} applied migration(s) are not in this checkout. ` +
      'The database was migrated by a newer checkout; update this one rather than migrating.\n',
  );
}

if (values['require-current'] === true && !isMigrationLevelCurrent(migrations)) {
  process.stderr.write('Schema is not current and --require-current was given.\n');
  process.exit(1);
}
