import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { acquireSuiteLock, ConcurrentSuiteError } from './suite-lock';

/**
 * Every case runs against a temporary lock file, never the real one.
 *
 * `pnpm test` must stay runnable while a heavy suite is in progress — it shares
 * nothing with them — so these tests must not touch the lock a real run holds.
 */
describe('acquireSuiteLock', () => {
  let directory: string;
  let lockPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orbit-suite-lock-'));
    lockPath = join(directory, 'nested', 'test-suite.lock');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('claims the lock and records who holds it', async () => {
    const lock = await acquireSuiteLock('test:runtime', { lockPath });

    const holder: unknown = JSON.parse(await readFile(lockPath, 'utf8'));

    expect(holder).toMatchObject({ suite: 'test:runtime', pid: process.pid });
    await lock.release();
  });

  it('refuses a second suite, naming both of them and the lock', async () => {
    const first = await acquireSuiteLock('test:runtime', { lockPath });

    const thrown = await acquireSuiteLock('test:e2e:watchtower', { lockPath }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(ConcurrentSuiteError);

    // The refusal is the whole point — it has to end a debugging session before
    // it starts — so the message itself is part of the contract.
    const { message } = thrown as ConcurrentSuiteError;

    expect(message).toContain('test:e2e:watchtower');
    expect(message).toContain('test:runtime');
    expect(message).toContain(lockPath);
    expect(message).toContain('orbit_test');

    await first.release();
  });

  it('lets the next suite start once the first releases', async () => {
    const first = await acquireSuiteLock('test:runtime', { lockPath });
    await first.release();

    const second = await acquireSuiteLock('test:e2e:watchtower', { lockPath });
    expect(second.suite).toBe('test:e2e:watchtower');
    await second.release();
  });

  /**
   * A suite killed with Ctrl-C never reaches its global teardown. Requiring a
   * developer to delete a file by hand before the next run would be a worse
   * failure than the one this module prevents.
   */
  it('reclaims a lock whose holder is no longer alive', async () => {
    // Acquired once so the directory exists, then overwritten with the record a
    // killed run would have left: a real file naming a process that is gone.
    const abandoned = await acquireSuiteLock('test:runtime', { lockPath });

    await writeFile(
      lockPath,
      JSON.stringify({
        suite: 'test:runtime',
        // Above every platform's pid ceiling, so it can never name a live
        // process. Not 0 — on POSIX that signals the caller's own group and
        // would read back as alive.
        pid: 2_147_483_647,
        token: 'abandoned',
        startedAt: new Date().toISOString(),
      }),
    );

    const next = await acquireSuiteLock('test:e2e:watchtower', { lockPath });
    expect(next.suite).toBe('test:e2e:watchtower');

    await next.release();
    await abandoned.release();
  });

  /**
   * The token check. Without it, a slow teardown would delete the lock a
   * *different* suite has since taken, reintroducing the concurrency this
   * module exists to prevent.
   */
  it('does not release a lock another suite has since taken', async () => {
    const first = await acquireSuiteLock('test:runtime', { lockPath });
    await first.release();

    const second = await acquireSuiteLock('test:e2e:watchtower', { lockPath });

    // The first suite's teardown, arriving late.
    await first.release();

    const holder: unknown = JSON.parse(await readFile(lockPath, 'utf8'));
    expect(holder).toMatchObject({ suite: 'test:e2e:watchtower' });

    await second.release();
  });
});
