import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isProcessAlive } from './managed-process';

/**
 * One suite at a time over the shared mutable test resources.
 *
 * `pnpm test:db`, `pnpm test:runtime` and `pnpm test:e2e:watchtower` all point
 * at the same `orbit_test` database, and two of them truncate it between tests.
 * `vitest.e2e.config.ts` has said so in prose since it was written — "two
 * projects, two commands, no shared mutable state" — but nothing enforced it,
 * and the failure mode when it is ignored is the expensive one: a suite whose
 * rows were deleted under it reports a *plausible assertion failure*, not a
 * resource error, so it sends you debugging a phantom.
 *
 * This makes the rule structural. The lock is exclusive-create rather than
 * check-then-write, so two suites starting in the same instant cannot both
 * believe they hold it.
 *
 * Deliberately fail-fast rather than a queue. A developer who launched the
 * wrong pair wants to know now, by name; silently blocking for the two minutes
 * the other suite needs looks identical to the hang this task exists to remove.
 *
 * Test-only, like everything else beside it in this directory.
 */

/**
 * Repository-local rather than machine-global.
 *
 * The resources guarded here are the ones *this checkout's* `.env` names, so a
 * second checkout with its own test database is not in conflict and must not be
 * blocked. The one machine-global resource the suites share — ports 3010 and
 * 3102 — is already guarded where it belongs, by `requireFreePorts()` in
 * `apps/api/src/testing/stack-global-setup.ts`.
 */
const LOCK_DIRECTORY = fileURLToPath(
  new URL('../../../../node_modules/.cache/orbit/', import.meta.url),
);

export const SUITE_LOCK_PATH = `${LOCK_DIRECTORY}test-suite.lock`;

export interface AcquireSuiteLockOptions {
  /** Overridden only by this module's own tests, so they cannot fight a real run. */
  readonly lockPath?: string;
}

/** What the holder writes about itself, so a refusal can name it. */
interface SuiteLockRecord {
  readonly suite: string;
  readonly pid: number;
  readonly token: string;
  readonly startedAt: string;
}

export interface SuiteLock {
  readonly suite: string;
  /** Releases the lock, and only if this process still holds it. Idempotent. */
  release(): Promise<void>;
}

/** A second suite tried to start while one that shares its database was running. */
export class ConcurrentSuiteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConcurrentSuiteError';
  }
}

/**
 * Claims the lock, or refuses with a message that names the other suite.
 *
 * A lock whose holder is no longer alive is reclaimed rather than reported: a
 * suite killed with Ctrl-C never reaches its teardown, and leaving a developer
 * to delete a file by hand would be a worse failure than the one being fixed.
 */
export async function acquireSuiteLock(
  suite: string,
  options: AcquireSuiteLockOptions = {},
): Promise<SuiteLock> {
  const lockPath = options.lockPath ?? SUITE_LOCK_PATH;

  await mkdir(dirname(lockPath), { recursive: true });

  const record: SuiteLockRecord = {
    suite,
    pid: process.pid,
    token: randomUUID(),
    startedAt: new Date().toISOString(),
  };

  // Two passes at most: one to find it stale and clear it, one to claim it.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const claimed = await tryClaim(lockPath, record);

    if (claimed) {
      return {
        suite,
        release: () => releaseIfHeldBy(lockPath, record.token),
      };
    }

    const holder = await readHolder(lockPath);

    if (holder !== undefined && isProcessAlive(holder.pid)) {
      throw new ConcurrentSuiteError(describeConflict(lockPath, record, holder));
    }

    // No holder record, or its process is gone: a previous run died before its
    // teardown. Clear it and claim on the next pass.
    await rm(lockPath, { force: true });
  }

  throw new ConcurrentSuiteError(
    `Could not claim the Orbit test-suite lock at ${lockPath} after reclaiming a stale one. ` +
      `Another suite is starting at the same moment; run ${suite} again.`,
  );
}

/** Exclusive create: the claim and the check are one filesystem operation. */
async function tryClaim(lockPath: string, record: SuiteLockRecord): Promise<boolean> {
  let handle;

  try {
    handle = await open(lockPath, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false;
    }
    throw error;
  }

  try {
    await handle.writeFile(JSON.stringify(record, null, 2));
  } finally {
    await handle.close();
  }

  return true;
}

async function readHolder(lockPath: string): Promise<SuiteLockRecord | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(lockPath, 'utf8'));

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'pid' in parsed &&
      typeof (parsed as { pid: unknown }).pid === 'number'
    ) {
      return parsed as SuiteLockRecord;
    }

    return undefined;
  } catch {
    // Missing, half-written, or not JSON. Either way there is no holder this
    // can name, and the caller treats that as stale.
    return undefined;
  }
}

/**
 * Releases only our own claim.
 *
 * The token check is what stops a late teardown from deleting the lock a
 * *different* suite has since taken — which would reintroduce exactly the
 * concurrency this module exists to prevent.
 */
async function releaseIfHeldBy(lockPath: string, token: string): Promise<void> {
  const holder = await readHolder(lockPath);

  if (holder?.token === token) {
    await rm(lockPath, { force: true });
  }
}

function describeConflict(
  lockPath: string,
  wanted: SuiteLockRecord,
  holder: SuiteLockRecord,
): string {
  const heldForSeconds = Math.max(
    0,
    Math.round((Date.now() - Date.parse(holder.startedAt)) / 1000),
  );

  return [
    `Refusing to start ${wanted.suite}: another Orbit test suite is already running.`,
    '',
    `  holding:  ${holder.suite} (pid ${holder.pid}), started ${holder.startedAt} (${heldForSeconds}s ago)`,
    `  wanted:   ${wanted.suite} (pid ${wanted.pid})`,
    `  lock:     ${lockPath}`,
    '',
    'These suites share one mutable resource: the `orbit_test` database, which two',
    'of them truncate between tests. Running them at once does not fail loudly — it',
    'deletes rows out from under the other suite and surfaces as ordinary-looking',
    'assertion failures. Run them one at a time.',
  ].join('\n');
}
