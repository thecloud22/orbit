import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

/**
 * A conversation with `b3270`, the JSON back end of Paul Mattes' x3270.
 *
 * Orbit does not implement the 3270 protocol. It drives the reference
 * implementation as a subprocess -- the same relationship
 * @orbit/executor-playwright has with Chromium, and authorised by the same
 * executor boundary (ADR-008, TASK-P3-000).
 *
 * That is the decision this whole package rests on. x3270 has been the reference
 * 3270 implementation since 1993 and handles telnet negotiation, TN3270E, TLS
 * and forty-one EBCDIC code pages. Reimplementing any of that would mean owning
 * a protocol whose correctness nothing could check -- a misreading of the data
 * stream would leave Orbit's parser and Orbit's tests agreeing with each other
 * and both wrong.
 *
 * The protocol is newline-delimited JSON in both directions: one object per line
 * out, an `{"run":{"actions":[...]}}` request in.
 */

export interface B3270Options {
  /** The binary to run. Overridable so a deployment can pin a build. */
  readonly command?: string;
  /** Terminal model, e.g. `3279-2`. Part of a binding's identity. */
  readonly model?: string;
  readonly codePage?: string;
}

export interface B3270Event {
  readonly [key: string]: unknown;
}

export type ActionResult =
  | { readonly ok: true; readonly text: readonly string[] }
  | { readonly ok: false; readonly message: string };

/**
 * One b3270 process, with its line protocol wrapped.
 *
 * Actions are serialised through a queue rather than issued concurrently: the
 * back end answers `run-result` objects in order and there is no correlation id,
 * so overlapping requests could not be matched to their answers.
 */
export class B3270Session {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending: ((result: ActionResult) => void)[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private lastOia: Record<string, unknown> = {};
  private closed = false;

  constructor(options: B3270Options = {}) {
    const args = ['-json'];
    if (options.model !== undefined) args.push('-model', options.model);
    if (options.codePage !== undefined) args.push('-codepage', options.codePage);

    this.child = spawn(options.command ?? 'b3270', args, { stdio: ['pipe', 'pipe', 'pipe'] });

    createInterface({ input: this.child.stdout }).on('line', (line) => {
      this.consume(line);
    });
  }

  private consume(line: string): void {
    let event: B3270Event;

    try {
      event = JSON.parse(line) as B3270Event;
    } catch {
      // b3270 emits only JSON; anything else is a build printing to stdout and
      // is not worth failing a run over.
      return;
    }

    if ('oia' in event && typeof event['oia'] === 'object' && event['oia'] !== null) {
      const oia = event['oia'] as { field?: string; value?: unknown };
      if (typeof oia.field === 'string') {
        this.lastOia[oia.field] = oia.value;
      }
    }

    if ('run-result' in event) {
      const result = event['run-result'] as {
        success?: boolean;
        text?: readonly string[];
        'abort-message'?: string;
      };
      const resolve = this.pending.shift();

      resolve?.(
        result.success === true
          ? { ok: true, text: result.text ?? [] }
          : { ok: false, message: result['abort-message'] ?? 'the emulator refused the action' },
      );
    }
  }

  /** The Operator Information Area's keyboard-lock state, or undefined. */
  lock(): unknown {
    return this.lastOia['lock'];
  }

  run(action: string, args: readonly string[] = []): Promise<ActionResult> {
    const issue = (): Promise<ActionResult> =>
      new Promise<ActionResult>((resolve) => {
        if (this.closed) {
          resolve({ ok: false, message: 'the emulator session is closed' });
          return;
        }

        this.pending.push(resolve);
        this.child.stdin.write(
          `${JSON.stringify({ run: { actions: [{ action, args: [...args] }] } })}\n`,
        );
      });

    this.queue = this.queue.then(issue, issue);
    return this.queue as Promise<ActionResult>;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    try {
      this.child.stdin.end();
    } finally {
      this.child.kill();
    }

    await Promise.resolve();
  }
}
