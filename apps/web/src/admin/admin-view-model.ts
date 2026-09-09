import type { PlatformDatabaseView, PlatformModelView, PlatformView } from '@orbit/api/views';

/**
 * The Admin page's reading of what the API reported.
 *
 * Presentation logic lives here rather than in the component for the reason
 * every other `*-view-model.ts` in this directory exists: the interesting cases
 * — a database migrated by a newer checkout, a deployment with no model
 * configured — are worth testing, and testing them through a rendered React
 * tree would test the wrong thing.
 *
 * Nothing here invents a fact. Every value below comes from `GET /v1/platform`
 * or from `GET /v1/model-usage`; if the API cannot report something, the page
 * omits it rather than guessing.
 */

/** One labelled, read-only fact. */
export interface AdminFact {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  /** Why the value matters, or what it is resolved from. Optional. */
  readonly detail: string | null;
}

export type MigrationTone = 'current' | 'behind' | 'ahead';

export interface MigrationStatus {
  readonly tone: MigrationTone;
  readonly headline: string;
  /** The command that resolves it, or null when nothing to run. */
  readonly action: string | null;
  readonly appliedLabel: string;
}

/**
 * Whether the schema this checkout expects has been applied.
 *
 * Three answers, not two. "Behind" is fixed by running the migrator; "ahead" —
 * applied rows matching no committed migration — is a database migrated by a
 * newer checkout than the one running, and no migration command fixes it, so
 * saying "run `pnpm db:migrate`" there would send an operator in a direction
 * that cannot work. Ahead wins when both are true, because it is the one that
 * has to be resolved first.
 */
export function describeMigrations(database: PlatformDatabaseView): MigrationStatus {
  const appliedLabel = `${database.migrationsApplied} of ${database.migrationsCommitted} committed migrations applied`;

  if (database.unrecognised > 0) {
    return {
      tone: 'ahead',
      headline: `This database has ${database.unrecognised} migration ${
        database.unrecognised === 1 ? 'row' : 'rows'
      } this checkout does not know about. It was migrated by a newer version of Orbit.`,
      action: null,
      appliedLabel,
    };
  }

  if (database.pending.length > 0) {
    return {
      tone: 'behind',
      headline: `${database.pending.length} committed ${
        database.pending.length === 1 ? 'migration has' : 'migrations have'
      } not been applied: ${database.pending.join(', ')}.`,
      action: 'pnpm db:migrate',
      appliedLabel,
    };
  }

  return {
    tone: 'current',
    headline: 'The schema this checkout expects has been applied.',
    action: null,
    appliedLabel,
  };
}

export interface ModelStatus {
  readonly configured: boolean;
  readonly headline: string;
  readonly detail: string;
}

/**
 * Which model is in force, said in one line.
 *
 * An unconfigured deployment is a legitimate configuration rather than a fault:
 * the API boots, every route that does not need a model works, and only
 * drafting fails. The wording says that instead of reading as an outage.
 */
export function describeModel(model: PlatformModelView): ModelStatus {
  if (!model.configured || model.family === null || model.model === null) {
    return {
      configured: false,
      headline: 'No model is configured.',
      detail:
        model.reason === null
          ? 'Drafting a workflow from text will fail; everything else works. Recording, binding, publishing and running need no model.'
          : `${model.reason} Drafting a workflow from text will fail until it is set; everything else works.`,
    };
  }

  return {
    configured: true,
    headline: `${model.family} · ${model.model}`,
    detail:
      model.invocation === 'bedrock'
        ? 'Reached through Amazon Bedrock.'
        : 'Reached directly, not through Bedrock.',
  };
}

/**
 * The deployment facts, in the order an operator reads them.
 *
 * Address first because it identifies which process answered, then where
 * evidence is written, then the database it is attached to. The model has its
 * own section and is not repeated here.
 */
export function platformFacts(platform: PlatformView): readonly AdminFact[] {
  return [
    {
      id: 'api-address',
      label: 'API address',
      value: `${platform.api.host}:${platform.api.port}`,
      detail: 'The address this API process is listening on. Set by API_HOST and API_PORT.',
    },
    {
      id: 'artifact-root',
      label: 'Artifact storage root',
      value: platform.artifactRoot,
      detail:
        'Where screenshots, DOM snapshots and traces are written. Set by ARTIFACT_STORAGE_DIR; metadata and links stay in PostgreSQL.',
    },
    {
      id: 'database-name',
      label: 'Database',
      value: `${platform.database.name} · PostgreSQL ${platform.database.serverVersion}`,
      detail:
        'The database this process is actually attached to, asked of the connection rather than read from a URL.',
    },
    {
      id: 'orphaned-runs',
      label: 'Orphaned runs',
      value:
        platform.orphanedRuns.length === 0
          ? 'None'
          : `${String(platform.orphanedRuns.length)} — ${platform.orphanedRuns.map((run) => run.runId).join(', ')}`,
      detail:
        platform.orphanedRuns.length === 0
          ? 'Every run either finished or was dispatched by this process. Phase 1 has no durable queue, so a run left queued or running by a process that is not this one was interrupted -- most often the API being killed mid-run.'
          : 'Left queued or running by a process that is not this one -- most often the API being killed mid-run. Detected, not resolved: deciding what an interrupted run should become is an operator call.',
    },
  ];
}
