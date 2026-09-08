import { acquireSuiteLock } from './suite-lock';

/**
 * The first global setup of every suite that mutates `orbit_test`.
 *
 * Listed ahead of the setups that bring up servers and prepare the schema, so a
 * refusal costs nothing: nothing has been started, and no table has been
 * touched. Vitest runs global teardowns in reverse, so the lock is also the
 * last thing released.
 *
 * The suite names itself through `ORBIT_TEST_SUITE`, set by the `package.json`
 * script, so a refusal can say which two commands collided. A missing variable
 * is not an error — someone running `vitest --config ...` by hand still gets
 * the lock, just a vaguer message.
 */
export default async function setup(): Promise<() => Promise<void>> {
  const suite = process.env['ORBIT_TEST_SUITE'] ?? 'an Orbit test suite';
  const lock = await acquireSuiteLock(suite);

  return async () => {
    await lock.release();
  };
}
