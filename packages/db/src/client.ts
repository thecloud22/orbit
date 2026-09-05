import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { databaseConfigSchema, type DatabaseConfig } from './config';
import * as schema from './schema';

export type OrbitDatabase = NodePgDatabase<typeof schema>;

/** The executor inside a `db.transaction(...)` callback. */
export type OrbitTransaction = Parameters<Parameters<OrbitDatabase['transaction']>[0]>[0];

/**
 * Anything a repository can run queries against.
 *
 * Repositories are built over this union rather than over a concrete database,
 * so any repository method can join a caller's transaction without knowing it
 * is in one.
 */
export type Executor = OrbitDatabase | OrbitTransaction;

export interface OrbitDatabaseHandle {
  readonly db: OrbitDatabase;
  readonly pool: pg.Pool;
  close(): Promise<void>;
}

/**
 * Opens a connection pool.
 *
 * The pool is returned rather than hidden in module state so tests and CLI
 * commands can close it deterministically; a leaked pool keeps a process alive.
 */
export function createDatabase(config: DatabaseConfig): OrbitDatabaseHandle {
  const resolved = databaseConfigSchema.parse(config);

  const pool = new pg.Pool({
    connectionString: resolved.url,
    max: resolved.maxConnections,
    connectionTimeoutMillis: resolved.connectionTimeoutMs,
  });

  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    close: async () => {
      await pool.end();
    },
  };
}
