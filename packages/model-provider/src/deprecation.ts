/**
 * Saying a variable is deprecated, once, to whatever the entry point logs with.
 *
 * Resolution is pure and returns its deprecations as data; emitting them is the
 * entry point's job, because the API has a Pino logger and the two CLIs have a
 * terminal. This is the small piece in between: it dedupes, so a process that
 * resolves a selection more than once — the browser worker resolves for the
 * judge, and could later resolve for something else — says it once rather than
 * once per call site.
 *
 * A warning, never a failure. The whole point of accepting the old names is
 * that a working `.env` keeps working; refusing to boot over one would make the
 * alias pointless.
 */

const alreadyNoticed = new Set<string>();

export type DeprecationSink = (message: string) => void;

export function noticeDeprecations(
  messages: readonly string[],
  // The default writes to stderr rather than to a logger: the two CLIs have no
  // logger, and the API passes its own sink so the notice lands in its stream.
  sink: DeprecationSink = (message) => process.stderr.write(`${message}\n`),
): void {
  for (const message of messages) {
    if (!alreadyNoticed.has(message)) {
      alreadyNoticed.add(message);
      sink(message);
    }
  }
}

/** Test support: the dedupe set outlives a single test otherwise. */
export function resetDeprecationNotices(): void {
  alreadyNoticed.clear();
}
