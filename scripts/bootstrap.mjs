#!/usr/bin/env node
/**
 * `pnpm bootstrap` — brings a checkout to the point where `pnpm dev` works.
 *
 * This is the documented manual setup sequence, executed and checked. It does
 * only what this repository actually supports, and it is deliberately
 * conservative about three things:
 *
 *  - **It never overwrites an existing `.env`.** A `.env` holds real API keys.
 *    A setup script that clobbered one would destroy something it cannot
 *    restore, so an existing file is left exactly as it is and reported.
 *  - **It never creates, drops or resets a database.** Creating the role and
 *    the two databases needs superuser credentials this script will not guess.
 *    When they are missing it prints the exact `psql` statements and stops.
 *  - **It does not start `pnpm dev`.** There is no supervisor here — `pnpm dev`
 *    is `pnpm -r --parallel dev`, five long-lived foreground processes whose
 *    lifetime belongs to the person running them. The script prints the exact
 *    next commands instead of owning a stack it cannot hand back.
 *
 * It is idempotent: every step is either already-satisfied-and-skipped or
 * safe to repeat, so running it on a working checkout is a health check.
 *
 * Nothing here prints an environment value. See `bootstrap-checks.mjs`.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  checkVersion,
  configurationIsUsable,
  serverAddressFromUrl,
  validateConfiguration,
} from './bootstrap-checks.mjs';

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENV_FILE = new URL('../.env', import.meta.url);
const ENV_EXAMPLE = new URL('../.env.example', import.meta.url);

const USAGE = `
Usage: pnpm bootstrap [options]

Prepares a local Orbit checkout: prerequisites, dependencies, environment file,
configuration, database connectivity, migrations, demo seed, and Chromium. It
then reports readiness and prints the commands to start the stack.

Options:
  --check-only     Report only. Installs nothing, writes no file, applies no
                   migration. Safe to run against a working checkout at any time.
  --skip-install   Do not run \`pnpm install\`.
  --skip-migrate   Do not run \`pnpm db:migrate\`.
  --skip-seed      Do not run \`pnpm db:seed\`.
  --seed-library   Also run \`pnpm db:seed:library\` (the branching demo).
  --skip-browser   Do not install the Playwright Chromium build.
  --help           Show this message.

It never overwrites an existing .env, never creates or drops a database, and
never starts \`pnpm dev\`.
`.trimStart();

const { values } = parseArgs({
  args: process.argv[2] === '--' ? process.argv.slice(3) : process.argv.slice(2),
  options: {
    'check-only': { type: 'boolean', default: false },
    'skip-install': { type: 'boolean', default: false },
    'skip-migrate': { type: 'boolean', default: false },
    'skip-seed': { type: 'boolean', default: false },
    'seed-library': { type: 'boolean', default: false },
    'skip-browser': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  allowPositionals: false,
});

if (values.help === true) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const checkOnly = values['check-only'] === true;

/** Ports the development stack binds, and the two nothing may bind. */
const DEVELOPMENT_PORTS = [
  { port: 3000, what: 'Watchtower' },
  { port: 3001, what: 'the demo portal' },
  { port: 3002, what: 'the API' },
  { port: 3020, what: 'the library portal' },
];

const RESERVED_PORTS = [
  { port: 3010, what: 'Watchtower in the end-to-end stack' },
  { port: 3102, what: 'the API in the end-to-end stack' },
];

/**
 * Both loopback stacks are probed, for the reason `check-teardown.mjs` gives:
 * Vite resolves `localhost` to `::1` first on macOS, so probing `127.0.0.1`
 * alone reports a live dev server as gone.
 */
const LOOPBACK_HOSTS = ['127.0.0.1', '::1'];

let failed = false;
let stepNumber = 0;

function heading(title) {
  stepNumber += 1;
  process.stdout.write(`\n[${stepNumber}] ${title}\n`);
}

function ok(message) {
  process.stdout.write(`  ok    ${message}\n`);
}

function info(message) {
  process.stdout.write(`  ...   ${message}\n`);
}

function warn(message) {
  process.stdout.write(`  warn  ${message}\n`);
}

function bad(message) {
  failed = true;
  process.stdout.write(`  FAIL  ${message}\n`);
}

function stop(message, guidance) {
  process.stderr.write(`\nBootstrap stopped: ${message}\n`);

  if (guidance !== undefined) {
    process.stderr.write(`${guidance}\n`);
  }

  process.exit(1);
}

/** Runs a command, streaming its output. Returns true when it succeeded. */
function run(command, args, { allowFailure = false } = {}) {
  info(`${command} ${args.join(' ')}`);

  const result = spawnSync(command, args, {
    cwd: REPOSITORY_ROOT,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error !== undefined && result.error !== null) {
    if (allowFailure) {
      return false;
    }
    stop(`could not run \`${command}\`: ${result.error.message}`);
  }

  return result.status === 0;
}

/** Reads a tool's version without letting a missing tool abort the script. */
function toolVersion(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });

  if (result.error !== undefined && result.error !== null) {
    return null;
  }

  if (result.status !== 0) {
    return null;
  }

  return String(result.stdout ?? '').trim();
}

function connectsTo(port, host) {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    let settled = false;

    const finish = (open) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(open);
      }
    };

    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function isPortOpen(port, hosts = LOOPBACK_HOSTS) {
  const results = await Promise.all(hosts.map((host) => connectsTo(port, host)));
  return results.some(Boolean);
}

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// ---------------------------------------------------------------------------

process.stdout.write('Orbit bootstrap\n');
process.stdout.write(`Repository: ${REPOSITORY_ROOT}\n`);

if (checkOnly) {
  process.stdout.write('Mode: --check-only. Nothing will be installed, written or migrated.\n');
}

// 1. Prerequisites -----------------------------------------------------------

heading('Prerequisites');

for (const check of [
  checkVersion({
    tool: 'Node.js',
    installed: process.version,
    range: manifest.engines?.node ?? '>=24',
  }),
  checkVersion({
    tool: 'pnpm',
    installed: toolVersion('pnpm', ['--version']),
    range: manifest.engines?.pnpm ?? '>=11',
  }),
]) {
  if (check.status === 'ok') {
    ok(check.detail);
  } else {
    bad(check.detail);
  }
}

if (failed) {
  stop(
    'a required tool is missing or too old.',
    'Node.js: install a release matching the engines range above.\n' +
      `pnpm: corepack enable && corepack prepare ${manifest.packageManager ?? 'pnpm'} --activate`,
  );
}

const psqlVersion = toolVersion('psql', ['--version']);

if (psqlVersion === null) {
  // Optional on purpose: Orbit connects with the `pg` driver and never shells
  // out to psql. It is only needed to create the role and databases by hand.
  warn('psql was not found. It is only needed to create the role and databases.');
} else {
  ok(`${psqlVersion} is on PATH.`);
}

// 2. Dependencies ------------------------------------------------------------

heading('Dependencies');

if (checkOnly || values['skip-install'] === true) {
  info('skipped; run `pnpm install --frozen-lockfile` to install dependencies.');
} else if (run('pnpm', ['install', '--frozen-lockfile'])) {
  ok('dependencies installed from the committed lockfile.');
} else {
  stop(
    '`pnpm install --frozen-lockfile` failed.',
    'If the lockfile is genuinely out of date, run `pnpm install` and commit the result.',
  );
}

// 3. Environment file --------------------------------------------------------

heading('Environment file');

const envPath = fileURLToPath(ENV_FILE);

if (existsSync(ENV_FILE)) {
  // Never touched. A .env can hold a real API key, and this script has no way
  // to put back something it overwrote.
  ok(`.env already exists and was left unchanged (${envPath}).`);
} else if (checkOnly) {
  warn('.env does not exist. Without --check-only it would be copied from .env.example.');
} else if (existsSync(ENV_EXAMPLE)) {
  copyFileSync(ENV_EXAMPLE, ENV_FILE);
  ok('.env created from .env.example. It is gitignored; edit it if your database differs.');
} else {
  bad('neither .env nor .env.example exists; there is nothing to configure from.');
}

// 4. Configuration -----------------------------------------------------------

heading('Configuration');

try {
  // Already-exported variables win, the same rule every CLI in this repository
  // follows, so CI can supply its own without a .env.
  process.loadEnvFile(envPath);
  info('.env loaded (already-exported variables win).');
} catch {
  info('no .env loaded; reading variables already present in the environment.');
}

const findings = validateConfiguration(process.env);

for (const finding of findings) {
  if (finding.status === 'ok') {
    ok(finding.detail);
  } else if (finding.status === 'absent') {
    warn(finding.detail);
  } else {
    bad(finding.detail);
  }
}

if (!configurationIsUsable(findings)) {
  stop(
    'the configuration is incomplete.',
    'See docs/guides/configuration.md. Values are never printed here on purpose.',
  );
}

// 5. PostgreSQL server -------------------------------------------------------

heading('PostgreSQL server');

const address = serverAddressFromUrl(process.env.DATABASE_URL ?? '');

if (address === null) {
  bad('could not read a host and port from DATABASE_URL.');
} else if (await isPortOpen(address.port, [address.hostname])) {
  ok(`something is accepting connections at ${address.hostname}:${address.port}.`);
} else {
  bad(`nothing is accepting connections at ${address.hostname}:${address.port}.`);
  stop(
    'the PostgreSQL server is not reachable.',
    'Start it (Homebrew: `brew services start postgresql@18`), or use the optional\n' +
      'container: `docker compose up -d`, then point DATABASE_URL at port 55432.',
  );
}

// 6. Database connectivity and schema level ----------------------------------

heading('Database connectivity');

if (!run('pnpm', ['db:check'], { allowFailure: true })) {
  stop(
    '`pnpm db:check` did not succeed. Read its output above: it distinguishes a\n' +
      'database Orbit cannot reach from a workspace whose dependencies are not installed.',
    'If dependencies are missing, run `pnpm install` (this run may have used --skip-install).\n\n' +
      'If the database is missing, the role and the two databases are created once,\n' +
      'by hand, as a superuser:\n\n' +
      `  psql -d postgres -c "CREATE ROLE orbit_dev LOGIN PASSWORD 'orbit_local_dev';"\n` +
      '  psql -d postgres -c "CREATE DATABASE orbit_dev OWNER orbit_dev;"\n' +
      '  psql -d postgres -c "CREATE DATABASE orbit_test OWNER orbit_dev;"\n\n' +
      'This script will not create or drop a database for you. See\n' +
      'docs/guides/installation.md > Create the database role and databases.',
  );
}

ok('the database answered and reported its migration level above.');

// 7. Migrations --------------------------------------------------------------

heading('Migrations');

if (checkOnly || values['skip-migrate'] === true) {
  info('skipped; run `pnpm db:migrate` to apply any pending migrations.');
} else if (run('pnpm', ['db:migrate'], { allowFailure: true })) {
  ok('committed migrations applied. Migrations only add schema; nothing is dropped.');
} else {
  stop('`pnpm db:migrate` failed.', 'See docs/guides/troubleshooting.md.');
}

// 8. Demo data ---------------------------------------------------------------

heading('Demo data');

if (checkOnly || values['skip-seed'] === true) {
  info('skipped; run `pnpm db:seed` to seed Find Service Request 0.1.0.');
} else if (run('pnpm', ['db:seed'], { allowFailure: true })) {
  ok('Find Service Request 0.1.0 is present. Seeding is idempotent.');
} else {
  // A changed fixture under an unchanged version number is refused, because a
  // published Agent Version is immutable. That is a correct refusal, not a
  // broken install, so it does not stop the rest of the bootstrap.
  bad('`pnpm db:seed` failed. If the fixture changed, bump its version (ADR-005).');
}

if (values['seed-library'] === true && !checkOnly) {
  if (run('pnpm', ['db:seed:library'], { allowFailure: true })) {
    ok('the branching library workflow is present.');
  } else {
    bad('`pnpm db:seed:library` failed.');
  }
}

// 9. Browser -----------------------------------------------------------------

heading('Browser');

if (checkOnly || values['skip-browser'] === true) {
  info(
    'skipped; run `pnpm --filter @orbit/demo-portal exec playwright install chromium` once per machine.',
  );
} else if (
  run('pnpm', ['--filter', '@orbit/demo-portal', 'exec', 'playwright', 'install', 'chromium'], {
    allowFailure: true,
  })
) {
  ok('Chromium is installed. Playwright skips the download when it already has it.');
} else {
  bad(
    'Chromium could not be installed. Running an agent, recording, `pnpm test:runtime` and the\n' +
      '        browser suites all need it; `pnpm test` and `pnpm test:db` do not.',
  );
}

// 10. Readiness --------------------------------------------------------------

heading('Readiness');

let servicesUp = 0;

for (const { port, what } of DEVELOPMENT_PORTS) {
  if (await isPortOpen(port)) {
    servicesUp += 1;
    ok(`port ${port} is answering — ${what} is already running.`);
  } else {
    info(`port ${port} is free — ${what} is not running.`);
  }
}

for (const { port, what } of RESERVED_PORTS) {
  if (await isPortOpen(port)) {
    warn(`port ${port} is held. It is reserved for ${what}; the end-to-end suite will collide.`);
  } else {
    ok(`reserved port ${port} is free.`);
  }
}

const apiPort = Number(process.env.API_PORT ?? 3002);

if (await isPortOpen(apiPort)) {
  try {
    const response = await fetch(`http://127.0.0.1:${apiPort}/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    const body = await response.json();

    if (response.ok && body?.status === 'ok') {
      ok(`GET /health on port ${apiPort} answered {"status":"ok"}.`);
    } else {
      warn(`something is on port ${apiPort} but /health did not answer ok.`);
    }
  } catch (error) {
    warn(`could not read /health on port ${apiPort}: ${error.message}`);
  }
}

// 11. Next steps -------------------------------------------------------------

heading('Next steps');

// A development stack that is already up is an ordinary state, not a leak:
// this script starts nothing and stops nothing, so it says what it found and
// leaves the running processes to whoever started them.
if (servicesUp === DEVELOPMENT_PORTS.length) {
  process.stdout.write(
    '  The development stack is already running, and this script did not touch it.\n' +
      '  Nothing more is needed. To restart it, Ctrl-C that process and run:\n',
  );
} else if (servicesUp > 0) {
  process.stdout.write(
    `  ${servicesUp} of ${DEVELOPMENT_PORTS.length} services are already running, and this\n` +
      '  script did not touch them. To run the whole stack together, stop those first:\n',
  );
} else {
  process.stdout.write('  Start the stack (five processes, foreground):\n');
}

process.stdout.write(
  '\n' +
    '    pnpm dev\n' +
    '\n' +
    '  Then:\n' +
    '    http://localhost:3000            Watchtower\n' +
    '    http://localhost:3001/requests   demo service-request portal\n' +
    '    http://localhost:3002/health     API health\n' +
    '    http://localhost:3020            demo library portal\n' +
    '\n' +
    '  Prove it end to end (needs the demo portal running):\n' +
    '    pnpm smoke --preflight   readiness only, writes nothing\n' +
    '    pnpm smoke               executes both documented scenarios\n' +
    '\n' +
    '  Verify the checkout:\n' +
    '    pnpm verify        typecheck, lint, format:check, test, test:db\n' +
    '\n' +
    '  Stop everything with Ctrl-C, then confirm nothing survived:\n' +
    '    pnpm check:teardown\n',
);

if (failed) {
  process.stderr.write('\nBootstrap finished with failures. See the FAIL lines above.\n');
  process.exit(1);
}

process.stdout.write(
  checkOnly ? '\nCheck finished: no problems found.\n' : '\nBootstrap finished.\n',
);
