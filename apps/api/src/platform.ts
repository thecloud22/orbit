import { inspectDatabase, type DatabaseCheck, type Executor } from '@orbit/db';
import type { ModelResolution } from '@orbit/model-provider';

/**
 * Read-only facts about the deployment this API process is.
 *
 * Everything here is decided before the first request and cannot be changed by
 * one. Provider selection and token ceilings are resolved once at process start
 * (`index.ts`), the artifact root is resolved once in `env.ts`, and the address
 * is whatever the process was told to listen on. The Admin page exists to
 * *show* those, and this is the seam it reads them through.
 *
 * There is deliberately no writer. `routes/model-usage.ts` already states the
 * rule for budgets — "a cap a client could lift is not a cap" — and it applies
 * to every field below for the same reason: these are deployment configuration,
 * so changing one means restarting the process with a different environment,
 * not posting to an endpoint. Making any of them writable would reverse a
 * recorded decision and needs an ADR first.
 *
 * A member of `ApiContext` like every other, so the route can be tested against
 * a fake with no database.
 */
export interface PlatformFacts {
  describe(): Promise<PlatformSnapshot>;
}

export interface PlatformSnapshot {
  /** What the process is listening on. Never a database or provider URL. */
  readonly api: { readonly host: string; readonly port: number };
  /** Where artifact bytes are written, resolved against the repository root. */
  readonly artifactRoot: string;
  readonly model: ModelSelectionSummary;
  readonly database: DatabaseCheck;
}

/**
 * Which model this deployment resolved, with the credential removed.
 *
 * `ModelSelection` carries an `apiKey`, and this type exists so that value has
 * no path to a response body, a projection or a React prop. Only the three
 * things an operator needs in order to know what is in force survive the
 * mapping — family, invocation, model id — plus the reason nothing is
 * configured, which names a *variable* and never its contents.
 *
 * The Bedrock region is dropped too. It is not a secret, but it is not needed
 * to answer "which model is in force", and the narrower this type stays the
 * less there is to review.
 */
export interface ModelSelectionSummary {
  readonly configured: boolean;
  readonly family: string | null;
  readonly invocation: string | null;
  readonly model: string | null;
  /** Names the missing variable when nothing is configured. Never a value. */
  readonly reason: string | null;
}

export const UNREPORTED_MODEL_SELECTION: ModelSelectionSummary = {
  configured: false,
  family: null,
  invocation: null,
  model: null,
  reason: 'This process did not report a model selection.',
};

/** Drops the credential and keeps the three axes an operator reads. */
export function summariseModelSelection(resolution: ModelResolution): ModelSelectionSummary {
  if (resolution.status === 'unconfigured') {
    return {
      configured: false,
      family: null,
      invocation: null,
      model: null,
      reason: resolution.reason,
    };
  }

  return {
    configured: true,
    family: resolution.selection.family,
    invocation: resolution.selection.invocation,
    model: resolution.selection.model,
    reason: null,
  };
}

export interface PlatformFactsDependencies {
  /** The connection the process already holds; no second pool is opened. */
  readonly executor: Executor;
  readonly artifactRoot: string;
  readonly host: string;
  readonly port: number;
  readonly modelSelection: ModelSelectionSummary;
}

export function createPlatformFacts(deps: PlatformFactsDependencies): PlatformFacts {
  return {
    async describe(): Promise<PlatformSnapshot> {
      // The one fact that is not fixed at boot: a database can be migrated
      // underneath a running process, which is exactly the case an operator
      // opens this page to check. Read on every request rather than cached.
      const database = await inspectDatabase(deps.executor);

      return {
        api: { host: deps.host, port: deps.port },
        artifactRoot: deps.artifactRoot,
        model: deps.modelSelection,
        database,
      };
    },
  };
}
