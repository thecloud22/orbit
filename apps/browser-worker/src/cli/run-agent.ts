import { parseArgs } from 'node:util';

import { createLocalFilesystemArtifactStorage } from '@orbit/artifacts';
import { agentVersionIdSchema, type RunTrigger } from '@orbit/contracts';
import { createDatabase, createRepositories, requireDatabaseUrl } from '@orbit/db';
import {
  executeAgentVersion,
  isRuntimeError,
  prepareExecution,
  RuntimeError,
} from '@orbit/runtime';
import {
  createDatabaseExecutionBindingResolver,
  createDatabaseRunStore,
} from '@orbit/runtime/persistence';
import {
  createDatabaseRecoveryProposalStore,
  createDriftRecoveryProposer,
} from '@orbit/drift-recovery';
import { createPlaywrightExecutorFactory } from '@orbit/executor-playwright';
import { pino } from 'pino';

import { loadRootEnv, resolveRepositoryArtifactRoot } from './env';
import {
  createJudge,
  resolveDecisionSettings,
  resolveGlobalBudget,
  resolveJudgeModelRates,
} from './judge';

/**
 * `pnpm agent:run -- --request-number SR-1001`
 *
 * The one local entry point for executing a seeded, published Agent Version.
 * There is deliberately no HTTP surface, no queue, no daemon, and no scheduler:
 * this process starts, runs exactly one agent once, prints a structured result,
 * and exits.
 *
 * It expects the demo portal to already be running, the way `pnpm db:migrate`
 * expects a running PostgreSQL server. Starting and stopping the target is not
 * the runtime's job.
 */

/** The Agent Version seeded by `pnpm db:seed`. */
const DEFAULT_AGENT_VERSION_ID = 'agentv_find_service_request_0_1_0';

const PORTAL_PREFLIGHT_TIMEOUT_MS = 5_000;

const USAGE = `
Usage: pnpm agent:run -- --request-number <value> [options]

  --request-number <value>    Required. The typed dynamic input.
  --agent-version-id <id>     Defaults to ${DEFAULT_AGENT_VERSION_ID}.
  --headed                    Run the browser headed for debugging. Default: headless.
  --help                      Show this message.

Prerequisites: pnpm db:migrate && pnpm db:seed, and the demo portal running
(pnpm --filter @orbit/demo-portal dev).
`.trimStart();

loadRootEnv();

const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

function fail(message: string, detail?: unknown): never {
  process.stderr.write(`${message}\n`);
  if (detail !== undefined) {
    process.stderr.write(`${JSON.stringify(detail, null, 2)}\n`);
  }
  process.exit(1);
}

/**
 * Confirms the target is answering before a run is created.
 *
 * A run row for an execution that never had a chance to start is noise in the
 * evidence trail, and "connection refused" three steps deep is a worse message
 * than this one.
 */
async function assertPortalReachable(url: string): Promise<void> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(PORTAL_PREFLIGHT_TIMEOUT_MS) });
  } catch (error) {
    fail(
      `The demo portal at ${url} is not reachable.\n` +
        'Start it first:  pnpm --filter @orbit/demo-portal dev',
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}

// `pnpm agent:run -- --flag` forwards the `--` separator itself, which parseArgs
// would read as "everything after this is positional". Dropping a leading one
// lets both `pnpm agent:run -- --flag` and a direct `tsx ... --flag` work.
const argv = process.argv.slice(2);

const { values } = parseArgs({
  args: argv[0] === '--' ? argv.slice(1) : argv,
  options: {
    'request-number': { type: 'string' },
    'agent-version-id': { type: 'string' },
    headed: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  allowPositionals: false,
});

if (values.help === true) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const requestNumber = values['request-number'];

if (requestNumber === undefined) {
  fail(`--request-number is required.\n\n${USAGE}`);
}

const agentVersionId = agentVersionIdSchema.parse(
  values['agent-version-id'] ?? DEFAULT_AGENT_VERSION_ID,
);

const databaseUrl = requireDatabaseUrl('DATABASE_URL');
const artifactRoot = resolveRepositoryArtifactRoot();

const handle = createDatabase({ url: databaseUrl, maxConnections: 5 });

try {
  const agentVersion = await createRepositories(handle.db).agentVersions.findById(agentVersionId);

  if (agentVersion === null) {
    fail(
      `Agent Version "${agentVersionId}" does not exist. Run \`pnpm db:seed\` first.`,
      new RuntimeError({
        code: 'VALIDATION_ERROR',
        message: `Agent Version "${agentVersionId}" does not exist.`,
      }).toOrbitError(),
    );
  }

  // Refused here, before any run row exists: nothing about an execution that was
  // never attempted belongs in the evidence tables.
  const prepared = prepareExecution({
    agentVersionId,
    agentIr: agentVersion.agentIr,
    rawInputs: { requestNumber },
  });

  const firstNavigation = prepared.agentIr.steps.find((step) => step.type === 'browser.navigate');
  if (firstNavigation !== undefined && firstNavigation.type === 'browser.navigate') {
    await assertPortalReachable(firstNavigation.url);
  }

  const trigger: RunTrigger = {
    type: 'watchtower_manual',
    actor: { type: 'development_user', id: process.env['ORBIT_ACTOR_ID'] ?? 'dev-user' },
    source: { application: 'orbit-browser-worker' },
  };

  const storage = await createLocalFilesystemArtifactStorage({ root: artifactRoot });

  // Wired here and nowhere else. A deployment with no key configured gets no
  // judge, every 0.1 agent runs exactly as before, and an agent that needs
  // judgement halts saying so rather than failing obscurely three steps in.
  const judge = createJudge({
    repositories: createRepositories(handle.db),
    rates: resolveJudgeModelRates(),
    globalBudget: resolveGlobalBudget(),
  });

  // The approved fingerprints this version was compiled from. A version with no
  // candidate — every Phase 1 agent — resolves to none and runs unchanged.
  const bindings = await createDatabaseExecutionBindingResolver({
    database: handle.db,
    agentVersionId: prepared.agentVersionId,
  });

  // Always wired; the agent's own `permissions.recovery` decides whether it is
  // ever consulted, and a proposal never rescues the run that produced it.
  const recovery = createDriftRecoveryProposer({
    store: createDatabaseRecoveryProposalStore({ database: handle.db }),
  });

  const result = await executeAgentVersion({
    agentVersionId: prepared.agentVersionId,
    agentIr: prepared.agentIr,
    inputs: prepared.inputs,
    trigger,
    store: createDatabaseRunStore({ database: handle.db, storage }),
    executors: {
      browser: createPlaywrightExecutorFactory({
        headless: !(values.headed === true || process.env['ORBIT_BROWSER_HEADED'] === 'true'),
      }),
    },
    logger,
    ...(judge === undefined ? {} : { judge }),
    ...(bindings === undefined ? {} : { bindings }),
    recovery,
    decisions: resolveDecisionSettings(),
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  if (result.terminalPersistenceFailed) {
    process.stderr.write(
      `Run ${result.runId} could not be given a terminal status and is left non-terminal in the database.\n`,
    );
  }

  if (result.runEvidenceMissing) {
    process.stderr.write(`Run ${result.runId} failed and its trace could not be persisted.\n`);
  }

  process.exitCode = result.status === 'succeeded' ? 0 : 1;
} catch (error) {
  if (isRuntimeError(error)) {
    fail(`The run was refused: ${error.message}`, error.toOrbitError());
  }
  throw error;
} finally {
  await handle.close();
}
