/**
 * The decisions `bootstrap.mjs` makes, separated from the things it does.
 *
 * Every function here is pure: it takes strings and returns verdicts, touching
 * no filesystem, no network and no child process. That is what makes the two
 * properties that matter testable by `pnpm test`, which needs nothing but a
 * checkout — that a version requirement is read from the manifest rather than
 * hard-coded, and that **no configuration verdict ever carries the value it
 * inspected**. A bootstrap script that helpfully echoed `DATABASE_URL` would
 * print a password into a terminal and, from CI, into a log.
 */

/** Parses a leading `major.minor.patch`, tolerating a `v` prefix and suffixes. */
export function parseVersion(text) {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(text).trim());

  if (match === null) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
  };
}

/** Reads the major from a `>=24` style engines range. Returns null if absent. */
export function minimumMajorFromRange(range) {
  const match = /(\d+)/.exec(String(range ?? ''));
  return match === null ? Number.NaN : Number(match[1]);
}

/**
 * Compares an installed version against an engines range from package.json.
 *
 * The requirement is never written down here. It is read from the manifest, so
 * raising `engines.node` cannot leave the bootstrap script quietly accepting
 * the version it used to accept.
 */
export function checkVersion({ tool, installed, range }) {
  const minimumMajor = minimumMajorFromRange(range);

  if (installed === null || installed === undefined || String(installed).trim() === '') {
    return {
      tool,
      status: 'missing',
      detail: `${tool} was not found on PATH. Required: ${range}.`,
    };
  }

  const parsed = parseVersion(installed);

  if (parsed === null || Number.isNaN(minimumMajor)) {
    return {
      tool,
      status: 'unknown',
      detail: `Could not read a version for ${tool} (saw "${installed}"). Required: ${range}.`,
    };
  }

  if (parsed.major < minimumMajor) {
    return {
      tool,
      status: 'too-old',
      detail: `${tool} ${installed} is older than the required ${range}.`,
    };
  }

  return { tool, status: 'ok', detail: `${tool} ${installed} satisfies ${range}.` };
}

/** The database name a `postgresql://` URL points at, or null if unparseable. */
export function databaseNameFromUrl(url) {
  try {
    const parsed = new URL(url);

    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
      return null;
    }

    const name = parsed.pathname.replace(/^\//, '');
    return name === '' ? null : name;
  } catch {
    return null;
  }
}

/** The `host:port` a connection URL points at, for a plain reachability probe. */
export function serverAddressFromUrl(url) {
  try {
    const parsed = new URL(url);
    const port = parsed.port === '' ? 5432 : Number(parsed.port);
    const hostname = parsed.hostname === '' ? 'localhost' : parsed.hostname;

    return Number.isFinite(port) ? { hostname, port } : null;
  } catch {
    return null;
  }
}

/**
 * Checks the configuration Orbit needs, by name only.
 *
 * The rules mirror the ones the code itself enforces, so a verdict here means
 * the same thing the runtime will decide later: `DATABASE_URL` is required and
 * must be a PostgreSQL URL; `TEST_DATABASE_URL` is optional, but if present it
 * must name a database ending in `_test` and must not be the development
 * database. Values are never included in a finding — only variable names,
 * database names, and verdicts.
 */
export function validateConfiguration(env) {
  const findings = [];

  const databaseUrl = (env.DATABASE_URL ?? '').trim();
  const developmentName = databaseNameFromUrl(databaseUrl);

  if (databaseUrl === '') {
    findings.push({
      variable: 'DATABASE_URL',
      status: 'missing',
      detail: 'DATABASE_URL is not set. Copy .env.example to .env, or export it.',
    });
  } else if (developmentName === null) {
    findings.push({
      variable: 'DATABASE_URL',
      status: 'invalid',
      detail: 'DATABASE_URL is not a postgresql:// URL naming a database.',
    });
  } else {
    findings.push({
      variable: 'DATABASE_URL',
      status: 'ok',
      detail: `DATABASE_URL names database "${developmentName}".`,
    });
  }

  const testUrl = (env.TEST_DATABASE_URL ?? '').trim();
  const testName = databaseNameFromUrl(testUrl);

  if (testUrl === '') {
    findings.push({
      variable: 'TEST_DATABASE_URL',
      status: 'absent',
      detail: 'TEST_DATABASE_URL is not set. `pnpm test:db` needs it; nothing else does.',
    });
  } else if (testName === null) {
    findings.push({
      variable: 'TEST_DATABASE_URL',
      status: 'invalid',
      detail: 'TEST_DATABASE_URL is not a postgresql:// URL naming a database.',
    });
  } else if (!testName.endsWith('_test')) {
    findings.push({
      variable: 'TEST_DATABASE_URL',
      status: 'invalid',
      detail: `TEST_DATABASE_URL names database "${testName}", which does not end in "_test". The integration suite truncates every Orbit table and refuses to run against it.`,
    });
  } else if (developmentName !== null && testName === developmentName) {
    findings.push({
      variable: 'TEST_DATABASE_URL',
      status: 'invalid',
      detail: `TEST_DATABASE_URL and DATABASE_URL both name database "${testName}". The test database must be a different one.`,
    });
  } else {
    findings.push({
      variable: 'TEST_DATABASE_URL',
      status: 'ok',
      detail: `TEST_DATABASE_URL names database "${testName}".`,
    });
  }

  const artifactDir = (env.ARTIFACT_STORAGE_DIR ?? '').trim();

  findings.push({
    variable: 'ARTIFACT_STORAGE_DIR',
    status: 'ok',
    detail:
      artifactDir === ''
        ? 'ARTIFACT_STORAGE_DIR is not set; artifact bytes go to the default ./data/artifacts.'
        : 'ARTIFACT_STORAGE_DIR is set.',
  });

  return findings;
}

/** True when nothing in the configuration would stop Orbit from starting. */
export function configurationIsUsable(findings) {
  return !findings.some((finding) => finding.status === 'missing' || finding.status === 'invalid');
}
