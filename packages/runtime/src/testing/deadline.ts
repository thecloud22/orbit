/**
 * A bound on one await, well under the test file's own timeout.
 *
 * The difference this makes is in the message, not the duration. A test that
 * blocks on a stuck browser or a stuck query eventually dies of its
 * `testTimeout` and reports "Test timed out in 180000ms" — which names the
 * file and nothing else, and reads exactly like a slow machine. The observed
 * twelve-minute failure was worse still: most of that time was not counted
 * against the limit at all, because it was spent blocked somewhere the runner
 * could not see.
 *
 * Wrapping the one operation that can block says *which* operation did, in a
 * fraction of the time.
 *
 * Test-only.
 */
export async function withDeadline<T>(
  work: Promise<T>,
  milliseconds: number,
  description: string,
): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | undefined;

  const expired = new Promise<never>((_resolve, reject) => {
    handle = setTimeout(
      () =>
        reject(
          new Error(
            `${description} did not finish within ${milliseconds}ms. ` +
              `Nothing asserted anything — this is a blocked operation, not a failed expectation.`,
          ),
        ),
      milliseconds,
    );
  });

  try {
    return await Promise.race([work, expired]);
  } finally {
    // Cleared whichever side won. An uncleared timer keeps the Node event loop
    // alive past teardown, which is its own class of "the suite would not exit".
    if (handle !== undefined) {
      clearTimeout(handle);
    }

    // The losing side is still in flight when the deadline wins; without this
    // its eventual rejection is an unhandled one.
    work.catch(() => undefined);
  }
}
