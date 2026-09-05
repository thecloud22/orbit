import { describe, expect, it } from 'vitest';

import { assertPostgresUrl, databaseNameFromUrl, requireDatabaseUrl } from './config';
import { DatabaseConfigError } from './errors';

const URL_WITH_PASSWORD = 'postgresql://orbit_dev:secret-value@localhost:5432/orbit_dev';

describe('database configuration', () => {
  it('accepts both postgres URL schemes', () => {
    expect(assertPostgresUrl('postgres://u@h:5432/db', 'DATABASE_URL')).toBe(
      'postgres://u@h:5432/db',
    );
    expect(assertPostgresUrl('postgresql://u@h:5432/db', 'DATABASE_URL')).toBe(
      'postgresql://u@h:5432/db',
    );
  });

  it('rejects a URL that is not PostgreSQL', () => {
    expect(() => assertPostgresUrl('mysql://u@h/db', 'DATABASE_URL')).toThrow(DatabaseConfigError);
    expect(() => assertPostgresUrl('not a url', 'DATABASE_URL')).toThrow(DatabaseConfigError);
  });

  it('extracts the database name', () => {
    expect(databaseNameFromUrl(URL_WITH_PASSWORD)).toBe('orbit_dev');
  });

  it('requires the variable rather than defaulting to another database', () => {
    expect(() => requireDatabaseUrl('DATABASE_URL', {})).toThrow(DatabaseConfigError);
    expect(() => requireDatabaseUrl('DATABASE_URL', { DATABASE_URL: '   ' })).toThrow(
      DatabaseConfigError,
    );
  });

  it('never puts the connection URL in the error message', () => {
    try {
      requireDatabaseUrl('DATABASE_URL', { DATABASE_URL: 'mysql://u:secret-value@h/db' });
      expect.unreachable('expected a configuration error');
    } catch (error) {
      expect((error as Error).message).not.toContain('secret-value');
      expect((error as Error).message).toContain('DATABASE_URL');
    }
  });
});
