import { z } from 'zod';

import { DatabaseConfigError } from './errors';

/**
 * Database configuration.
 *
 * `DATABASE_URL` is the only connection setting Orbit reads. There are
 * deliberately no separate host/port/user/password variables that could drift
 * out of sync with it, and no default value: a missing URL is an error, never a
 * silent fallback to some other database.
 */
export const databaseConfigSchema = z.strictObject({
  url: z.string().min(1),
  maxConnections: z.number().int().positive().max(100).default(10),
  /** Fail fast rather than hanging a developer command on an unreachable server. */
  connectionTimeoutMs: z.number().int().positive().default(10_000),
});

export type DatabaseConfig = z.input<typeof databaseConfigSchema>;
export type ResolvedDatabaseConfig = z.output<typeof databaseConfigSchema>;

const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);

export function assertPostgresUrl(url: string, variableName: string): string {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new DatabaseConfigError(`${variableName} is not a valid URL.`);
  }

  if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) {
    throw new DatabaseConfigError(
      `${variableName} must be a postgresql:// URL, got "${parsed.protocol}//".`,
    );
  }

  return url;
}

/** The database name a connection URL points at, used by the test-target guard. */
export function databaseNameFromUrl(url: string): string {
  return new URL(url).pathname.replace(/^\//, '');
}

/**
 * Reads a required connection URL from the environment.
 *
 * Never prints the value: a connection URL carries a password, so failures
 * name the variable and nothing else.
 */
export function requireDatabaseUrl(
  variableName: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const value = env[variableName];

  if (value === undefined || value.trim() === '') {
    throw new DatabaseConfigError(
      `${variableName} is not set. See README > Local database for the expected value.`,
    );
  }

  return assertPostgresUrl(value.trim(), variableName);
}
