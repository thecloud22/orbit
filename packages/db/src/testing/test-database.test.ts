import { describe, expect, it } from 'vitest';

import { DatabaseConfigError, UnsafeDatabaseTargetError } from '../errors';
import { resolveTestDatabaseUrl } from './test-database';

const DEV = 'postgresql://orbit_dev:pw@localhost:5432/orbit_dev';
const TEST = 'postgresql://orbit_dev:pw@localhost:5432/orbit_test';

/**
 * These guards are the reason a developer can run `pnpm test:db` without
 * thinking about it. The integration suite truncates every Orbit table, so each
 * of these cases is one way that truncate could otherwise land on real data.
 */
describe('test database guard', () => {
  it('accepts a separate database whose name ends in _test', () => {
    expect(resolveTestDatabaseUrl({ TEST_DATABASE_URL: TEST, DATABASE_URL: DEV })).toBe(TEST);
  });

  it('refuses to fall back to DATABASE_URL when TEST_DATABASE_URL is unset', () => {
    expect(() => resolveTestDatabaseUrl({ DATABASE_URL: DEV })).toThrow(DatabaseConfigError);
    expect(() => resolveTestDatabaseUrl({ DATABASE_URL: DEV, TEST_DATABASE_URL: '' })).toThrow(
      DatabaseConfigError,
    );
  });

  it('rejects a database that is not named as a test database', () => {
    expect(() => resolveTestDatabaseUrl({ TEST_DATABASE_URL: DEV })).toThrow(
      UnsafeDatabaseTargetError,
    );
  });

  it('rejects pointing the test suite at the development database', () => {
    expect(() =>
      resolveTestDatabaseUrl({
        TEST_DATABASE_URL: 'postgresql://u:pw@localhost:5432/orbit_test',
        DATABASE_URL: 'postgresql://u:pw@otherhost:5432/orbit_test',
      }),
    ).toThrow(UnsafeDatabaseTargetError);
  });

  it('rejects a URL that is not PostgreSQL at all', () => {
    expect(() => resolveTestDatabaseUrl({ TEST_DATABASE_URL: 'mysql://u@h/orbit_test' })).toThrow(
      DatabaseConfigError,
    );
  });
});
