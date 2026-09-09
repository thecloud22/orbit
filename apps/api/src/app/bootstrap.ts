import { createLocalFilesystemArtifactStorage } from '@orbit/artifacts';
import { createArtifactService } from '@orbit/artifact-service';
import { createDatabase, createRepositories } from '@orbit/db';
import type { LLMProvider, ModelBudgets, ModelRates } from '@orbit/sop-generation';
import {
  approveBinding,
  createSopCandidateService,
  createSopDiscardService,
  createSopDraftService,
  createSopRuleService,
  createPublishBoundDocumentService,
  createRecoveryProposalService,
  createPublishRecordingService,
  createSopPublishService,
  createSopRevisionService,
  rejectBinding,
} from '@orbit/sop-service';

import { createBindingSessionRegistry } from '../recording/binding-session-registry';
import {
  createPlaywrightRecordingSessionFactory,
  createRecordingSessionRegistry,
} from '../recording/session-registry';
import { createWalkthroughSessionRegistry } from '../recording/walkthrough-session-registry';
import type { FastifyInstance } from 'fastify';

import type { ApiContext } from './context';
import {
  createPlatformFacts,
  UNREPORTED_MODEL_SELECTION,
  type ModelSelectionSummary,
} from './platform';
import type { RecordingSessionFactory } from '../recording/session-registry';
import { createInProcessRunDispatcher } from '../runs/dispatch';
import { withDuplicateDispatchSuppression } from '../runs/dispatch-dedup';
import { detectOrphanedRuns } from '../runs/orphan-runs';
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
  /**
   * Model token ceilings. Passed in rather than read here, for the same reason
   * the provider is: an entry point resolves the environment, and this function
   * composes what it is given (ADR-029).
   */
  readonly modelBudgets?: ModelBudgets;
  /** Per-model rates for the cost estimate. */
  readonly modelRates?: ModelRates;
  /**
   * Which model this deployment resolved, for the Admin page to report.
   *
   * A *summary*, not the selection: the credential is dropped by
   * `summariseModelSelection` in the entry point, so no API key is ever passed
   * into this function and none can reach a response body. Optional, because a
   * caller that composes its own provider — the end-to-end entry point does —
   * has no environment resolution to report, and saying so is better than
   * inventing one.
   */
  readonly modelSelection?: ModelSelectionSummary;
}

export interface StartedApi {
  readonly app: FastifyInstance;
  readonly url: string;
  close(): Promise<void>;
}

export async function startApi(options: ApiBootstrapOptions): Promise<StartedApi> {
  // As close to process boot as this function gets: a run queued before this
  // instant belongs to whatever process handled it before, not this one
  // (orphan-runs.ts).
  const processStartedAt = new Date();

  const handle = createDatabase({ url: options.databaseUrl });

  const storage = await createLocalFilesystemArtifactStorage({ root: options.artifactRoot });

  // Headed, because a person has to see and click the page they are recording.
  // That makes recording a local-machine capability, which the UI states.
  const browserSessionFactory =
    options.recordingSessionFactory ??
    createPlaywrightRecordingSessionFactory({
      headless: process.env['ORBIT_RECORDER_HEADLESS'] === 'true',
    });

  const recordingSessions = createRecordingSessionRegistry({
    database: handle.db,
    factory: browserSessionFactory,
  });

  // The second registry that holds a browser, built on the same factory and
  // closed on the same path. Separate from recording because saving a binding
  // leaves the browser open where finishing a recording closes it (ADR-027).
  const bindingSessions = createBindingSessionRegistry({
    database: handle.db,
    factory: browserSessionFactory,
  });

  // The third registry on the same factory, closed on the same path. Separate
  // from the other two because a walkthrough ends by proposing and closing,
  // where a recording ends by creating a document and a binding sitting never
  // ends at all (ADR-035).
  const walkthroughSessions = createWalkthroughSessionRegistry({
    database: handle.db,
    factory: browserSessionFactory,
  });

  const app = buildServer({
    context: {
      repositories: createRepositories(handle.db),
      artifactService: createArtifactService({ database: handle.db, storage }),
      sopDraftService: createSopDraftService({
        database: handle.db,
        provider: options.sopProvider,
        ...(options.modelBudgets === undefined ? {} : { budgets: options.modelBudgets }),
        ...(options.modelRates === undefined ? {} : { rates: options.modelRates }),
      }),
      // The same provider drafting uses. A rule is a smaller question asked of
      // the same model with the same credentials, and a second provider would
      // be a second thing to configure for no gain.
      sopRuleService: createSopRuleService({
        database: handle.db,
        provider: options.sopProvider,
        ...(options.modelBudgets === undefined ? {} : { budgets: options.modelBudgets }),
        ...(options.modelRates === undefined ? {} : { rates: options.modelRates }),
      }),
      sopDiscardService: createSopDiscardService({ database: handle.db }),
      sopRevisionService: createSopRevisionService({ database: handle.db }),
      bindingReview: {
        approve: (id, note) => approveBinding(handle.db, id, note),
        reject: (id, note) => rejectBinding(handle.db, id, note),
      },
      sopCandidateService: createSopCandidateService({ database: handle.db }),
      sopPublishService: createSopPublishService({ database: handle.db }),
      publishRecordingService: createPublishRecordingService({ database: handle.db }),
      publishBoundDocumentService: createPublishBoundDocumentService({ database: handle.db }),
      recoveryProposals: createRecoveryProposalService({ database: handle.db }),
      recordingSessions,
      bindingSessions,
      walkthroughSessions,
      modelBudgets: options.modelBudgets ?? {},
      // Reads the connection this process already holds rather than opening a
      // second pool, and re-reads the migration level per request: a database
      // can be migrated underneath a running API, which is the case an operator
      // opens the Admin page to check.
      platform: createPlatformFacts({
        executor: handle.db,
        artifactRoot: options.artifactRoot,
        host: options.host,
        port: options.port,
        modelSelection: options.modelSelection ?? UNREPORTED_MODEL_SELECTION,
        runs: createRepositories(handle.db).runs,
        processStartedAt,
      }),
      dispatcher: withDuplicateDispatchSuppression(
        createInProcessRunDispatcher({
          database: handle.db,
          storage,
          logger: {
            debug: (fields, message) => app.log.debug(fields, message),
            info: (fields, message) => app.log.info(fields, message),
            warn: (fields, message) => app.log.warn(fields, message),
          },
          headless: process.env['ORBIT_BROWSER_HEADED'] !== 'true',
          // The same ceilings Admin reports and drafting is checked against,
          // so a judged decision spends against one budget rather than a
          // second one nobody can see.
          modelBudgets: options.modelBudgets ?? {},
        }),
      ),
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

  // Detection only, at the moment it is cheapest to notice: everything
  // non-terminal at this instant necessarily predates this process, since
  // nothing has been dispatched yet (orphan-runs.ts). Logged rather than
  // acted on -- an operator decides what a run that was actually interrupted
  // should become, not a boot-time guess.
  const orphanedAtBoot = detectOrphanedRuns(
    await createRepositories(handle.db).runs.listNonTerminal(),
    processStartedAt,
  );

  if (orphanedAtBoot.length > 0) {
    app.log.warn(
      { orphanedRuns: orphanedAtBoot.map((run) => ({ runId: run.runId, status: run.status })) },
      `${String(orphanedAtBoot.length)} run(s) were left ${orphanedAtBoot.length === 1 ? 'in a non-terminal state' : 'in non-terminal states'} by a previous process and were not resumed. See Admin > Platform.`,
    );
  }

  return {
    app,
    url: `http://${options.host}:${options.port}`,
    close: async () => {
      await app.close();
      // Any browser a recording still holds goes with the process that opened
      // it; a stranded Chromium outlives the API otherwise.
      await recordingSessions.closeAll();
      await bindingSessions.closeAll();
      await walkthroughSessions.closeAll();
      await handle.close();
    },
  };
}
