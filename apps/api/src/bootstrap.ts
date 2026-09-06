import { createLocalFilesystemArtifactStorage } from '@orbit/artifacts';
import { createArtifactService } from '@orbit/artifact-service';
import { createDatabase, createRepositories } from '@orbit/db';
import type { LLMProvider } from '@orbit/sop-generation';
import { createSopDraftService, createSopRevisionService } from '@orbit/sop-service';

import {
  createPlaywrightRecordingSessionFactory,
  createRecordingSessionRegistry,
} from './recording/session-registry';
import type { FastifyInstance } from 'fastify';

import type { ApiContext } from './context';
import type { RecordingSessionFactory } from './recording/session-registry';
import { createInProcessRunDispatcher } from './dispatch';
import { buildServer } from './server';

/**
 * Composing and starting the API.
 *
 * This exists as a function so that the one dependency an end-to-end test must
 * substitute — which system generates business content — can be passed in,
 * rather than selected by an environment variable inside the shipped entry
 * point. An env branch there would be a live path to a test double in a real
 * deployment, gated only by a variable someone could set by accident.
 *
 * Both entry points call this, so what an end-to-end run exercises is the real
 * composition, the real routes, and the real persistence. The difference
 * between them is exactly one constructor argument.
 */

export interface ApiBootstrapOptions {
  /** The only dependency the two entry points differ on. */
  readonly sopProvider: LLMProvider;
  readonly databaseUrl: string;
  readonly artifactRoot: string;
  readonly port: number;
  readonly host: string;
  readonly logLevel?: string;
  /**
   * Supplied only by the end-to-end entry point, which records without a
   * display.
   *
   * What is substituted is the browser and nothing else: the registry, its
   * lifecycle, the translation and the persistence are all the real ones, so an
   * end-to-end recording produces a genuine document.
   */
  readonly recordingSessionFactory?: RecordingSessionFactory;
}

export interface StartedApi {
  readonly app: FastifyInstance;
  readonly url: string;
  close(): Promise<void>;
}

export async function startApi(options: ApiBootstrapOptions): Promise<StartedApi> {
  const handle = createDatabase({ url: options.databaseUrl });
  const storage = await createLocalFilesystemArtifactStorage({ root: options.artifactRoot });

  // Headed, because a person has to see and click the page they are recording.
  // That makes recording a local-machine capability, which the UI states.
  const recordingSessions = createRecordingSessionRegistry({
    database: handle.db,
    factory:
      options.recordingSessionFactory ??
      createPlaywrightRecordingSessionFactory({
        headless: process.env['ORBIT_RECORDER_HEADLESS'] === 'true',
      }),
  });

  const app = buildServer({
    context: {
      repositories: createRepositories(handle.db),
      artifactService: createArtifactService({ database: handle.db, storage }),
      sopDraftService: createSopDraftService({
        database: handle.db,
        provider: options.sopProvider,
      }),
      sopRevisionService: createSopRevisionService({ database: handle.db }),
      recordingSessions,
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
    ...(options.logLevel === undefined ? {} : { logLevel: options.logLevel }),
  });

  try {
    await app.listen({ port: options.port, host: options.host });
  } catch (error) {
    app.log.error(error);
    await handle.close();
    throw error;
  }

  return {
    app,
    url: `http://${options.host}:${options.port}`,
    close: async () => {
      await app.close();
      // Any browser a recording still holds goes with the process that opened
      // it; a stranded Chromium outlives the API otherwise.
      await recordingSessions.closeAll();
      await handle.close();
    },
  };
}
