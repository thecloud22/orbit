import type { AgentIr } from '@orbit/agent-ir';
import type { ArtifactStorage } from '@orbit/artifacts';
import type { AgentVersionId, RunId, RunInputs, RunTrigger } from '@orbit/contracts';
import type { OrbitDatabase } from '@orbit/db';
import { createPlaywrightExecutorFactory } from '@orbit/executor-playwright';
import {
  executeAgentVersion,
  type BrowserExecutorFactory,
  type RunRecorder,
  type RunStore,
  type RuntimeLogger,
} from '@orbit/runtime';
import {
  createDatabaseExecutionBindingResolver,
  createDatabaseRunStore,
} from '@orbit/runtime/persistence';
import {
  createDatabaseRecoveryProposalStore,
  createDriftRecoveryProposer,
} from '@orbit/drift-recovery';

/**
 * The run dispatch seam (ADR-011).
 *
 * Phase 1 has no durable queue, but execution is still not coupled to the HTTP
 * request lifecycle: a caller gets a run id as soon as the run row exists, and
 * the browser work continues after the response has been sent. Replacing this
 * with a queue later means implementing this interface, not reshaping the route.
 */
export interface RunDispatcher {
  dispatch(request: DispatchRunRequest): Promise<DispatchedRun>;
}

export interface DispatchRunRequest {
  readonly agentVersionId: AgentVersionId;
  readonly agentIr: AgentIr;
  /** Already validated against the Agent Version's declarations. */
  readonly inputs: RunInputs;
  readonly trigger: RunTrigger;
}

export interface DispatchedRun {
  readonly runId: RunId;
  /**
   * Settles when execution finishes. Never rejects: a failed run is a persisted
   * fact on the run row, not an exception for the dispatcher's caller. The HTTP
   * route ignores this; tests await it.
   */
  readonly completed: Promise<void>;
}

export interface InProcessDispatcherDependencies {
  readonly database: OrbitDatabase;
  readonly storage: ArtifactStorage;
  readonly logger: RuntimeLogger;
  /** Headed mode is a developer debugging aid; headless is the default. */
  readonly headless?: boolean;
  /**
   * Overrides how a browser session is opened. Production leaves this unset and
   * gets Playwright; tests inject a double so the real dispatch path — including
   * how the run id is observed — is exercised without launching Chromium.
   */
  readonly browser?: BrowserExecutorFactory;
}

/**
 * Runs the agent in this process, immediately.
 *
 * The run id is obtained by wrapping the runtime's own `RunStore` port and
 * observing the moment the run row is created — the runtime is used exactly as
 * Task 6 defined it, with no change to its semantics and no second run row.
 */
export function createInProcessRunDispatcher(deps: InProcessDispatcherDependencies): RunDispatcher {
  const browser =
    deps.browser ?? createPlaywrightExecutorFactory({ headless: deps.headless ?? true });

  // Always wired; the *agent* decides whether it is ever consulted. An Agent
  // Version that does not declare `permissions.recovery.allowed` produces no
  // proposals and is not even probed on drift (ADR-033).
  const recovery = createDriftRecoveryProposer({
    store: createDatabaseRecoveryProposalStore({ database: deps.database }),
  });

  return {
    async dispatch(request: DispatchRunRequest): Promise<DispatchedRun> {
      const store = createDatabaseRunStore({ database: deps.database, storage: deps.storage });

      let announceRunId: (runId: RunId) => void = () => undefined;
      let announceFailure: (error: unknown) => void = () => undefined;

      const runIdReady = new Promise<RunId>((resolve, reject) => {
        announceRunId = resolve;
        announceFailure = reject;
      });

      const observing: RunStore = {
        async createRun(input): Promise<RunRecorder> {
          const recorder = await store.createRun(input);
          announceRunId(recorder.runId);
          return recorder;
        },
      };

      // The approved fingerprints this version was compiled from, and the
      // proposer that turns a drift into a proposal. Both are loaded before the
      // run row exists, so a version with no bindings costs one query and
      // executes exactly as it did before either existed.
      //
      // Wiring the resolver here is what makes the drift check (ADR-018) live
      // in a real run for the first time: it has been implemented since 2.4 and
      // no production entry point had ever supplied it a binding.
      const bindings = await createDatabaseExecutionBindingResolver({
        database: deps.database,
        agentVersionId: request.agentVersionId,
      });

      const completed = executeAgentVersion({
        agentVersionId: request.agentVersionId,
        agentIr: request.agentIr,
        inputs: request.inputs,
        trigger: request.trigger,
        store: observing,
        executors: { browser },
        logger: deps.logger,
        ...(bindings === undefined ? {} : { bindings }),
        recovery,
      })
        .then((result) => {
          deps.logger.info(
            {
              runId: result.runId,
              status: result.status,
              businessOutcome: result.businessOutcome,
              terminalPersistenceFailed: result.terminalPersistenceFailed,
            },
            'Run finished.',
          );
        })
        .catch((error: unknown) => {
          // Reached only when execution failed before the run row existed; once
          // it exists the runtime records the failure on the run itself.
          announceFailure(error);
          deps.logger.warn(
            { cause: error instanceof Error ? error.message : String(error) },
            'Run dispatch failed before a run was created.',
          );
        });

      const runId = await runIdReady;

      return { runId, completed };
    },
  };
}
