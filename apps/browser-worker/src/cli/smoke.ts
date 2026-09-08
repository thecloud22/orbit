import { parseArgs } from 'node:util';

import { createLocalFilesystemArtifactStorage } from '@orbit/artifacts';
import {
  agentVersionIdSchema,
  type ArtifactKind,
  type EventType,
  type RunId,
  type RunTrigger,
} from '@orbit/contracts';
import {
  checkDatabase,
  createDatabase,
  createRepositories,
  isMigrationLevelCurrent,
  requireDatabaseUrl,
  seedFindServiceRequest,
  type OrbitRepositories,
} from '@orbit/db';
import { createDriftRecoveryProposer } from '@orbit/drift-recovery';
import { createDatabaseRecoveryProposalStore } from '@orbit/drift-recovery';
import { createPlaywrightExecutorFactory } from '@orbit/executor-playwright';
import {
  executeAgentVersion,
  isRuntimeError,
  prepareExecution,
  type BrowserExecutor,
  type BrowserExecutorFactory,
} from '@orbit/runtime';
import {
  createDatabaseExecutionBindingResolver,
  createDatabaseRunStore,
} from '@orbit/runtime/persistence';
import { pino } from 'pino';

import {
  checkEvidence,
  FOUND_SCENARIO,
  NOT_FOUND_SCENARIO,
  type PersistedEvidence,
  type SmokeScenario,
} from '../smoke/expectations';
import { loadRootEnv, resolveRepositoryArtifactRoot } from './env';

/**
 * `pnpm smoke` — proves this installation can execute a workflow end to end.
 *
 * It is the readiness check `pnpm bootstrap` deliberately stops short of. The
 * bootstrap proves a checkout is *set up*; this proves the set-up actually
 * works, by driving the seeded Phase 1 agent through a real Chromium against
 * the real demo portal and then reading the evidence back **out of the
 * database** rather than trusting the value the runtime returned.
 *
 * What it does not do, on purpose:
 *
 *  - **It starts nothing.** Not the portal, not the API, not `pnpm dev`. A
 *    portal that is already listening is adopted; one that is not produces the
 *    exact command to start it. This is what lets the check run beside a
 *    development session without fighting it or stopping anything.
 *  - **It creates no agent of its own.** The version it runs is the one
 *    `pnpm db:seed` publishes from the committed fixture, through the ordinary
 *    validate-then-publish path. There is no test-only shortcut into the
 *    published state, because a smoke test that published by a route no user
 *    can take would be proving the wrong thing.
 *  - **It never resets anything.** It adds runs to whatever `DATABASE_URL`
 *    names, exactly as pressing Start run in Watchtower does. It truncates no
 *    table and drops nothing.
 *
 * Every phase is bounded and fails fast. A smoke check that hangs is worse than
 * one that fails: it tells you nothing and it blocks whatever was waiting.
 */

/** The Agent Version `pnpm db:seed` publishes. */
const AGENT_VERSION_ID = agentVersionIdSchema.parse('agentv_find_service_request_0_1_0');

const DEFAULT_RUN_TIMEOUT_MS = 120_000;
const PORTAL_PROBE_TIMEOUT_MS = 5_000;
const BROWSER_CLEANUP_TIMEOUT_MS = 15_000;

const USAGE = `
Usage: pnpm smoke [options]

Runs the seeded Find Service Request agent against the demo portal and checks
that the run reached its expected terminal state and left the required evidence.

  --preflight        Check readiness only. Executes no run and writes nothing.
  --found-only       Run only the SR-1001 scenario, not the SR-9999 one.
  --seed             Seed the Phase 1 agent if it is not present yet.
  --timeout <ms>     Wall-clock bound per run. Default ${DEFAULT_RUN_TIMEOUT_MS}.
  --headed           Show the automation browser.
  --help             Show this message.

Requires: a migrated database, the seeded agent, an installed Chromium, and the
demo portal already running (pnpm --filter @orbit/demo-portal dev). It starts
none of those itself, and it never resets a database.
`.trimStart();

loadRootEnv();

const argv = process.argv.slice(2);

const { values } = parseArgs({
  args: argv[0] === '--' ? argv.slice(1) : argv,
  options: {
    preflight: { type: 'boolean', default: false },
    'found-only': { type: 'boolean', default: false },
    seed: { type: 'boolean', default: false },
    timeout: { type: 'string' },
    headed: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  allowPositionals: false,
});

if (values.help === true) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const runTimeoutMs = values.timeout === undefined ? DEFAULT_RUN_TIMEOUT_MS : Number(values.timeout);

if (!Number.isFinite(runTimeoutMs) || runTimeoutMs <= 0) {
  process.stderr.write('--timeout must be a positive number of milliseconds.\n');
  process.exit(1);
}

let phaseNumber = 0;

function phase(title: string): void {
  phaseNumber += 1;
  process.stdout.write(`\n[${phaseNumber}] ${title}\n`);
}

function ok(message: string): void {
  process.stdout.write(`  ok    ${message}\n`);
}

function info(message: string): void {
  process.stdout.write(`  ...   ${message}\n`);
}

function fail(message: string, guidance?: string): never {
  process.stderr.write(`\nSmoke check FAILED: ${message}\n`);

  if (guidance !== undefined) {
    process.stderr.write(`${guidance}\n`);
  }

  process.exit(1);
}

/**
 * Bounds a promise by wall-clock time.
 *
 * The loser of the race is not cancellable — a Playwright execution in flight
 * keeps its browser — so a timeout here is terminal for the process rather than
 * something the caller recovers from. That is the intended trade: this check
 * exists to give a fast answer, and hanging is the one outcome that makes it
 * useless. The run row is left as the runtime last wrote it, and the exit
 * message says so.
 */
async function within<T>(work: Promise<T>, timeoutMs: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${what} did not finish within ${timeoutMs}ms.`)),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([work, expiry]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/** True while something answers at the URL. Never starts anything. */
async function isReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(PORTAL_PROBE_TIMEOUT_MS) });
    return response.ok;
  } catch {
    return false;
  }
}

// 1. Configuration -----------------------------------------------------------

phase('Configuration');

const databaseUrl = requireDatabaseUrl('DATABASE_URL');
ok('DATABASE_URL is set and is a PostgreSQL URL. Its value is never printed.');

const artifactRoot = resolveRepositoryArtifactRoot();
ok(`artifact bytes will be written under ${artifactRoot}`);

// 2. Database ----------------------------------------------------------------

phase('Database');

const databaseState = await checkDatabase(databaseUrl).catch((error: unknown) =>
  fail(
    `could not reach the database: ${error instanceof Error ? error.message : String(error)}`,
    'Run `pnpm db:check` for the full diagnosis, or `pnpm bootstrap --check-only`.',
  ),
);

ok(
  `connected to "${databaseState.databaseName}" (PostgreSQL ${databaseState.serverVersion}), ` +
    `${databaseState.migrations.applied.length} of ${databaseState.migrations.committed.length} migrations applied.`,
);

if (!isMigrationLevelCurrent(databaseState.migrations)) {
  fail(
    'the database schema is not current.',
    databaseState.migrations.pending.length > 0
      ? `Pending: ${databaseState.migrations.pending.join(', ')}. Run \`pnpm db:migrate\`.`
      : 'The database was migrated by a newer checkout than this one. Update the checkout.',
  );
}

ok('the schema matches this checkout.');

const handle = createDatabase({ url: databaseUrl, maxConnections: 5 });

const repositories: OrbitRepositories = createRepositories(handle.db);

// 3. Seeded agent ------------------------------------------------------------

phase('Agent version');

let agentVersion = await repositories.agentVersions.findById(AGENT_VERSION_ID);

if (agentVersion === null && values.seed === true) {
  // The ordinary seed path: the committed fixture, validated through
  // @orbit/agent-ir and published as an immutable version. Not a shortcut.
  info('not present; seeding it from the committed fixture, the same way `pnpm db:seed` does.');
  const seeded = await seedFindServiceRequest(handle.db);
  agentVersion = await repositories.agentVersions.findById(seeded.agentVersion.id);
}

if (agentVersion === null) {
  fail(
    `Agent Version "${AGENT_VERSION_ID}" is not published in this database.`,
    'Run `pnpm db:seed`, or re-run this check with --seed.',
  );
}

// A const rather than the reassignable binding above: narrowing on a `let` does
// not survive into the closure that runs each scenario.
const publishedVersion = agentVersion;

ok(`${publishedVersion.name} ${publishedVersion.version} is published (${publishedVersion.id}).`);

// 4. Target ------------------------------------------------------------------

phase('Target');

const firstNavigation = publishedVersion.agentIr.steps.find(
  (step) => step.type === 'browser.navigate',
);

if (firstNavigation === undefined || firstNavigation.type !== 'browser.navigate') {
  fail('the published agent has no navigation step, so there is nothing to smoke-test.');
}

const targetUrl = firstNavigation.url;

if (!(await isReachable(targetUrl))) {
  fail(
    `nothing is answering at ${targetUrl}.`,
    'This check starts nothing. Start the target first:\n' +
      '  pnpm --filter @orbit/demo-portal dev\n' +
      'or start the whole stack with `pnpm dev`.',
  );
}

ok(`${targetUrl} is answering. It was already running and was not started by this check.`);

if (values.preflight === true) {
  await handle.close();
  process.stdout.write(
    '\nPreflight passed. Nothing was executed and nothing was written.\n' +
      'Run `pnpm smoke` without --preflight to execute the workflow.\n',
  );
  process.exit(0);
}

// 5. Execute and check evidence ----------------------------------------------

const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'warn' });

const storage = await createLocalFilesystemArtifactStorage({ root: artifactRoot });

const trigger: RunTrigger = {
  type: 'watchtower_manual',
  actor: { type: 'development_user', id: process.env['ORBIT_ACTOR_ID'] ?? 'dev-user' },
  source: { application: 'orbit-smoke-check' },
};

/** Re-reads a finished run from the database. The result object is not trusted. */
async function readEvidence(runId: RunId): Promise<PersistedEvidence> {
  const [run, steps, events, artifacts] = await Promise.all([
    repositories.runs.findById(runId),
    repositories.runSteps.listByRun(runId),
    repositories.runEvents.listByRun(runId),
    repositories.artifacts.listByRun(runId),
  ]);

  if (run === null) {
    throw new Error(`Run ${runId} is not in the database after executing.`);
  }

  return {
    runId: run.id,
    status: run.status,
    businessOutcome: run.businessOutcome,
    outputs: run.outputs,
    stepCount: steps.length,
    eventTypes: events.map((event) => event.eventType as EventType),
    artifactKinds: artifacts.map((artifact) => artifact.kind as ArtifactKind),
  };
}

/**
 * The Playwright factory, with every browser it opens remembered.
 *
 * A timeout exits the process, and `process.exit` does not run the runtime's
 * own cleanup for an execution still in flight — which would leave a Chromium
 * behind and make `pnpm check:teardown` fail. Holding the handles is what lets
 * the timeout path close them itself. On the ordinary path the runtime has
 * already closed each one and closing again is harmless.
 */
const openedBrowsers: BrowserExecutor[] = [];

const trackedBrowsers: BrowserExecutorFactory = {
  async open() {
    const executor = await createPlaywrightExecutorFactory({
      headless: !(values.headed === true || process.env['ORBIT_BROWSER_HEADED'] === 'true'),
    }).open();

    openedBrowsers.push(executor);
    return executor;
  },
};

/** Closes anything still open, itself bounded so cleanup cannot hang either. */
async function closeBrowsers(): Promise<void> {
  if (openedBrowsers.length === 0) {
    return;
  }

  await within(
    Promise.all(openedBrowsers.map((executor) => executor.close().catch(() => undefined))),
    BROWSER_CLEANUP_TIMEOUT_MS,
    'closing the browser',
  ).catch(() => {
    process.stderr.write(
      'A browser did not close within the cleanup bound. Run `pnpm check:teardown`.\n',
    );
  });
}

async function runScenario(scenario: SmokeScenario): Promise<boolean> {
  phase(`Scenario: ${scenario.name} (${scenario.requestNumber})`);

  const prepared = prepareExecution({
    agentVersionId: AGENT_VERSION_ID,
    agentIr: publishedVersion.agentIr,
    rawInputs: { requestNumber: scenario.requestNumber },
  });

  const bindings = await createDatabaseExecutionBindingResolver({
    database: handle.db,
    agentVersionId: prepared.agentVersionId,
  });

  const recovery = createDriftRecoveryProposer({
    store: createDatabaseRecoveryProposalStore({ database: handle.db }),
  });

  info(`executing, bounded at ${runTimeoutMs}ms.`);

  const result = await within(
    executeAgentVersion({
      agentVersionId: prepared.agentVersionId,
      agentIr: prepared.agentIr,
      inputs: prepared.inputs,
      trigger,
      store: createDatabaseRunStore({ database: handle.db, storage }),
      browser: trackedBrowsers,
      logger,
      ...(bindings === undefined ? {} : { bindings }),
      recovery,
    }),
    runTimeoutMs,
    `the ${scenario.name} run`,
  );

  ok(`run ${result.runId} reached a terminal state.`);

  if (result.terminalPersistenceFailed) {
    process.stdout.write(`  FAIL  run ${result.runId} was left non-terminal in the database.\n`);
  }

  const evidence = await readEvidence(result.runId);
  const problems = checkEvidence(scenario, evidence);

  if (problems.length === 0) {
    ok(
      `status "${evidence.status}", outcome "${evidence.businessOutcome}", ` +
        `${evidence.stepCount} steps, ${evidence.eventTypes.length} events, ` +
        `${evidence.artifactKinds.length} artifacts — all as expected.`,
    );
    return true;
  }

  process.stdout.write(`  FAIL  run ${evidence.runId} is not what this scenario expects:\n`);

  for (const problem of problems) {
    process.stdout.write(`          ${problem.check}: ${problem.detail}\n`);
  }

  return false;
}

const scenarios: readonly SmokeScenario[] =
  values['found-only'] === true ? [FOUND_SCENARIO] : [FOUND_SCENARIO, NOT_FOUND_SCENARIO];

let allPassed = true;

try {
  for (const scenario of scenarios) {
    if (!(await runScenario(scenario))) {
      allPassed = false;
    }
  }
} catch (error) {
  const detail = isRuntimeError(error)
    ? `${error.message}\n${JSON.stringify(error.toOrbitError(), null, 2)}`
    : error instanceof Error
      ? error.message
      : String(error);

  // Before exiting, not after: `fail` ends the process, so anything this check
  // opened has to be closed here or it survives as a leaked browser.
  await closeBrowsers();
  await handle.close();

  fail(
    detail,
    'A timeout leaves the run row as the runtime last wrote it. This check closed the\n' +
      'browser it opened; `pnpm check:teardown` confirms nothing survived.',
  );
} finally {
  await closeBrowsers();
  await handle.close();
}

if (!allPassed) {
  process.stderr.write(
    '\nSmoke check FAILED. The runs above are in the database with their evidence;\n' +
      'open them in Watchtower to see what happened.\n',
  );
  process.exit(1);
}

process.stdout.write(
  `\nSmoke check passed. ${scenarios.length} workflow(s) executed end to end against\n` +
    `${targetUrl}, and every run's evidence was read back from the database.\n`,
);
