import { describe, expect, it } from 'vitest';

import {
  checkVersion,
  configurationIsUsable,
  databaseNameFromUrl,
  minimumMajorFromRange,
  parseVersion,
  serverAddressFromUrl,
  validateConfiguration,
} from './bootstrap-checks.mjs';

const SECRET = 'sup3r-s3cret-passw0rd';

/**
 * Built rather than string-substituted. `postgresql://orbit_dev:...` contains
 * the substring `/orbit_dev` in its userinfo as well as its path, so deriving
 * one fixture from another by `replace` silently corrupts the URL instead of
 * renaming the database — which is how the first draft of these tests passed
 * for the wrong reason.
 */
const urlFor = (database) =>
  `postgresql://orbit_dev:${SECRET}@db.example.internal:6543/${database}`;

const DEVELOPMENT_URL = urlFor('orbit_dev');
const TEST_URL = urlFor('orbit_test');

describe('parseVersion', () => {
  it('reads a plain version', () => {
    expect(parseVersion('11.25.0')).toEqual({ major: 11, minor: 25, patch: 0 });
  });

  it('tolerates the v prefix node --version prints', () => {
    expect(parseVersion('v26.8.1')).toEqual({ major: 26, minor: 8, patch: 1 });
  });

  it('ignores a prerelease suffix', () => {
    expect(parseVersion('24.0.0-rc.1')).toEqual({ major: 24, minor: 0, patch: 0 });
  });

  it('returns null for something that is not a version', () => {
    expect(parseVersion('command not found')).toBeNull();
  });
});

describe('minimumMajorFromRange', () => {
  it('reads the major out of an engines range', () => {
    expect(minimumMajorFromRange('>=24')).toBe(24);
    expect(minimumMajorFromRange('>=11')).toBe(11);
  });

  it('is NaN when there is no number to read', () => {
    expect(Number.isNaN(minimumMajorFromRange('*'))).toBe(true);
    expect(Number.isNaN(minimumMajorFromRange(undefined))).toBe(true);
  });
});

describe('checkVersion', () => {
  it('accepts an installed version at or above the range', () => {
    expect(checkVersion({ tool: 'Node.js', installed: 'v26.8.1', range: '>=24' }).status).toBe(
      'ok',
    );
    expect(checkVersion({ tool: 'Node.js', installed: 'v24.0.0', range: '>=24' }).status).toBe(
      'ok',
    );
  });

  it('rejects an installed version below the range', () => {
    const result = checkVersion({ tool: 'Node.js', installed: 'v22.11.0', range: '>=24' });

    expect(result.status).toBe('too-old');
    expect(result.detail).toContain('>=24');
  });

  it('reports a tool that is not installed', () => {
    expect(checkVersion({ tool: 'pnpm', installed: null, range: '>=11' }).status).toBe('missing');
    expect(checkVersion({ tool: 'pnpm', installed: '', range: '>=11' }).status).toBe('missing');
  });

  it('reports an unreadable version rather than guessing', () => {
    expect(checkVersion({ tool: 'psql', installed: 'nonsense', range: '>=16' }).status).toBe(
      'unknown',
    );
  });
});

describe('databaseNameFromUrl and serverAddressFromUrl', () => {
  it('reads the database name', () => {
    expect(databaseNameFromUrl(DEVELOPMENT_URL)).toBe('orbit_dev');
  });

  it('refuses a URL that is not PostgreSQL', () => {
    expect(databaseNameFromUrl('mysql://localhost/orbit')).toBeNull();
    expect(databaseNameFromUrl('not a url')).toBeNull();
  });

  it('reads host and port, defaulting the port to 5432', () => {
    expect(serverAddressFromUrl(DEVELOPMENT_URL)).toEqual({
      hostname: 'db.example.internal',
      port: 6543,
    });
    expect(serverAddressFromUrl('postgresql://user:pw@localhost/orbit_dev')).toEqual({
      hostname: 'localhost',
      port: 5432,
    });
  });
});

describe('validateConfiguration', () => {
  const findingFor = (findings, variable) => findings.find((entry) => entry.variable === variable);

  it('accepts a well-formed local configuration', () => {
    const findings = validateConfiguration({
      DATABASE_URL: DEVELOPMENT_URL,
      TEST_DATABASE_URL: TEST_URL,
      ARTIFACT_STORAGE_DIR: './data/artifacts',
    });

    expect(configurationIsUsable(findings)).toBe(true);
    expect(findingFor(findings, 'DATABASE_URL').status).toBe('ok');
    expect(findingFor(findings, 'TEST_DATABASE_URL').status).toBe('ok');
  });

  it('fails when DATABASE_URL is absent', () => {
    const findings = validateConfiguration({});

    expect(configurationIsUsable(findings)).toBe(false);
    expect(findingFor(findings, 'DATABASE_URL').status).toBe('missing');
  });

  it('fails when DATABASE_URL is not a PostgreSQL URL', () => {
    const findings = validateConfiguration({ DATABASE_URL: 'http://localhost:5432/orbit_dev' });

    expect(findingFor(findings, 'DATABASE_URL').status).toBe('invalid');
  });

  it('treats a missing TEST_DATABASE_URL as absent rather than broken', () => {
    const findings = validateConfiguration({ DATABASE_URL: DEVELOPMENT_URL });

    expect(configurationIsUsable(findings)).toBe(true);
    expect(findingFor(findings, 'TEST_DATABASE_URL').status).toBe('absent');
  });

  it('refuses a test database whose name does not end in _test', () => {
    const findings = validateConfiguration({
      DATABASE_URL: DEVELOPMENT_URL,
      TEST_DATABASE_URL: urlFor('orbit_scratch'),
    });

    expect(configurationIsUsable(findings)).toBe(false);
    expect(findingFor(findings, 'TEST_DATABASE_URL').detail).toContain('_test');
  });

  it('refuses a test database that is the development database', () => {
    const findings = validateConfiguration({
      DATABASE_URL: urlFor('orbit_test'),
      TEST_DATABASE_URL: TEST_URL,
    });

    expect(configurationIsUsable(findings)).toBe(false);
    expect(findingFor(findings, 'TEST_DATABASE_URL').detail).toContain('different one');
  });

  // The property the whole module exists to guarantee. A bootstrap script that
  // echoed what it inspected would print a password to a terminal, and from CI
  // into a log that outlives the run.
  it('never puts an environment value into a finding', () => {
    const findings = validateConfiguration({
      DATABASE_URL: DEVELOPMENT_URL,
      TEST_DATABASE_URL: TEST_URL,
      ARTIFACT_STORAGE_DIR: '/home/someone/private/artifacts',
    });

    const printed = findings.map((finding) => finding.detail).join('\n');

    expect(printed).not.toContain(SECRET);
    expect(printed).not.toContain(DEVELOPMENT_URL);
    expect(printed).not.toContain(TEST_URL);
    expect(printed).not.toContain('/home/someone/private/artifacts');
  });
});
