import { sql } from 'drizzle-orm';
import { text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Column conventions shared by every Orbit table.
 *
 * Timestamps are always `timestamptz` in UTC: evidence that cannot be ordered
 * across time zones is not evidence. IDs are always opaque prefixed strings,
 * never database sequences, so nothing about storage leaks into a public
 * identifier and IDs stay stable across environments.
 */

export function opaqueId<T extends string>(name: string) {
  return text(name).$type<T>();
}

export function timestamptz(name: string) {
  return timestamp(name, { withTimezone: true, mode: 'date' });
}

export function createdAt() {
  return timestamptz('created_at').notNull().defaultNow();
}

export function updatedAt() {
  return timestamptz('updated_at').notNull().defaultNow();
}

/**
 * Builds an `IN (...)` check from a contract's enum values, so the database and
 * the Zod schema cannot disagree about what a column may hold.
 *
 * The values are inlined as SQL literals rather than bound parameters: a CHECK
 * constraint is DDL, and PostgreSQL does not accept placeholders there. Every
 * value is a compile-time constant from this codebase, and quotes are escaped
 * regardless.
 */
export function inValues(column: unknown, values: readonly string[]) {
  const literals = sql.raw(values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', '));
  return sql`${column} IN (${literals})`;
}

/** Lowercase hex sha-256, matching `artifactMetadataSchema`. */
export function isSha256(column: unknown) {
  return sql`${column} ~ '^[a-f0-9]{64}$'`;
}
