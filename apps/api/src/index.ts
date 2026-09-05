import { createLocalFilesystemArtifactStorage } from '@orbit/artifacts';
import { createArtifactService } from '@orbit/artifact-service';
import { createDatabase, createRepositories, requireDatabaseUrl } from '@orbit/db';

import type { ApiContext } from './context';
import { createInProcessRunDispatcher } from './dispatch';
import { loadRootEnv, resolveRepositoryArtifactRoot } from './env';
import { buildServer } from './server';

/**
 * The API process.
 *
 * It is also the run executor in Phase 1: there is no queue and no worker fleet
 * (ADR-011), so a dispatched run launches a browser in this process and
 * continues after the HTTP response has been sent.
 */
loadRootEnv();

const port = Number(process.env['API_PORT'] ?? 3002);
const host = process.env['API_HOST'] ?? '127.0.0.1';

const handle = createDatabase({ url: requireDatabaseUrl('DATABASE_URL') });
const storage = await createLocalFilesystemArtifactStorage({
  root: resolveRepositoryArtifactRoot(),
});

const app = buildServer({
  context: {
    repositories: createRepositories(handle.db),
    artifactService: createArtifactService({ database: handle.db, storage }),
    dispatcher: createInProcessRunDispatcher({
      database: handle.db,
      storage,
      logger: {
        debug: (fields, message) => app.log.debug(fields, message),
        info: (fields, message) => app.log.info(fields, message),
        warn: (fields, message) => app.log.warn(fields, message),
      },
      headless: process.env['ORBIT_BROWSER_HEADED'] !== 'true',
    }),
  } satisfies ApiContext,
});

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  await handle.close();
  process.exit(1);
}
