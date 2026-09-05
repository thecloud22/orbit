import { createDatabase } from '../client';
import { requireDatabaseUrl } from '../config';
import { databaseNameFromUrl } from '../config';
import { seedFindServiceRequest } from '../seed';
import { loadRootEnv } from './env';

/**
 * `pnpm db:seed`.
 *
 * Seeds the one Phase 1 Agent Version. Idempotent: running it twice against an
 * unchanged fixture reports "already present" rather than creating a duplicate.
 */
loadRootEnv();

const url = requireDatabaseUrl('DATABASE_URL');
const handle = createDatabase({ url, maxConnections: 1 });

try {
  const { agentVersion, created } = await seedFindServiceRequest(handle.db);

  process.stdout.write(
    `${created ? 'Seeded' : 'Already present'}: ${agentVersion.name} ${agentVersion.version} ` +
      `(${agentVersion.id}) in database "${databaseNameFromUrl(url)}".\n`,
  );
} finally {
  await handle.close();
}
