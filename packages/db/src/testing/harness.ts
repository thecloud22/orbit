import { afterAll, beforeAll, beforeEach } from 'vitest';

import { createTestDatabase, loadTestEnv, type OrbitTestDatabase } from './test-database';

/**
 * Connects an integration test file to the guarded test database.
 *
 * Every test starts from empty tables. Sharing one connection pool per file and
 * truncating between tests is far faster than recreating the schema, and it
 * keeps each test independent of what ran before it.
 */
export function useTestDatabase(): () => OrbitTestDatabase {
  let database: OrbitTestDatabase | undefined;

  beforeAll(async () => {
    loadTestEnv();
    database = await createTestDatabase();
  });

  beforeEach(async () => {
    await database?.truncate();
  });

  afterAll(async () => {
    await database?.close();
    database = undefined;
  });

  return () => {
    if (database === undefined) {
      throw new Error('The test database is not ready; useTestDatabase() must run in a suite.');
    }
    return database;
  };
}
