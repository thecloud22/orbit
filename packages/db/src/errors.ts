/**
 * Typed persistence failures.
 *
 * Every one of these exists so a violated invariant fails loudly at the point
 * it is violated. Nothing in this package returns a plausible-looking value
 * when the database disagrees with the domain contract.
 */
export class OrbitDatabaseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Persisted data no longer satisfies the contract it was written under. */
export class DatabaseIntegrityError extends OrbitDatabaseError {}

/** A record required by the operation does not exist. */
export class RecordNotFoundError extends OrbitDatabaseError {}

/** A run or step was asked to move to a status its current status does not permit. */
export class InvalidRunTransitionError extends OrbitDatabaseError {}

/** Configuration required to reach a database is missing or unusable. */
export class DatabaseConfigError extends OrbitDatabaseError {}

/** A destructive test-only operation was pointed at a database that is not the test database. */
export class UnsafeDatabaseTargetError extends OrbitDatabaseError {}

/** An attempt was made to change an immutable published Agent Version. */
export class ImmutableAgentVersionError extends OrbitDatabaseError {}

const PG_UNIQUE_VIOLATION = '23505';
const PG_LOCK_NOT_AVAILABLE = '55P03';
const PG_FOREIGN_KEY_VIOLATION = '23503';
const PG_CHECK_VIOLATION = '23514';
const PG_NOT_NULL_VIOLATION = '23502';

/**
 * Reads a property from a thrown value, following `cause`.
 *
 * Drizzle wraps driver errors, so the PostgreSQL `code` and `constraint` sit on
 * the cause rather than the thrown error. Callers should not have to know how
 * deep the wrapping goes to ask "which constraint rejected this?".
 */
function fromErrorChain(error: unknown, property: string): string | undefined {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    if (property in current) {
      const value = (current as Record<string, unknown>)[property];
      if (typeof value === 'string') {
        return value;
      }
    }

    current = 'cause' in current ? (current as { cause: unknown }).cause : undefined;
  }

  return undefined;
}

function errorCode(error: unknown): string | undefined {
  return fromErrorChain(error, 'code');
}

export function isUniqueViolation(error: unknown): boolean {
  return errorCode(error) === PG_UNIQUE_VIOLATION;
}

export function isForeignKeyViolation(error: unknown): boolean {
  return errorCode(error) === PG_FOREIGN_KEY_VIOLATION;
}

export function isCheckViolation(error: unknown): boolean {
  return errorCode(error) === PG_CHECK_VIOLATION;
}

export function isNotNullViolation(error: unknown): boolean {
  return errorCode(error) === PG_NOT_NULL_VIOLATION;
}

/**
 * A statement gave up waiting for a lock another session holds.
 *
 * Only raised where a `lock_timeout` is set, which today is the destructive
 * test reset: without a bound, a `TRUNCATE` blocked behind a live connection
 * waits forever, and the suite's own timeout cannot see that it is waiting.
 */
export function isLockNotAvailable(error: unknown): boolean {
  return errorCode(error) === PG_LOCK_NOT_AVAILABLE;
}

/** The name of the constraint a database error violated, when the driver reports one. */
export function violatedConstraint(error: unknown): string | undefined {
  return fromErrorChain(error, 'constraint');
}
