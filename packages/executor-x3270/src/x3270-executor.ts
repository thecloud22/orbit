import type { AidKey } from '@orbit/agent-ir';
import {
  RuntimeError,
  type SurfaceEvidence,
  type TerminalConnectRequest,
  type TerminalExecutor,
  type TerminalPressRequest,
  type TerminalTypeRequest,
} from '@orbit/runtime';
import type { Screen } from '@orbit/screen-mapping';

import { B3270Session, type B3270Options } from './b3270';
import { parseReadBuffer } from './screen-parser';

/** The emulator action each AID key maps to. A closed map for a closed enum. */
const AID_ACTIONS: Record<AidKey, string> = {
  enter: 'Enter',
  clear: 'Clear',
  pa1: 'PA(1)',
  pa2: 'PA(2)',
  pa3: 'PA(3)',
  pf1: 'PF(1)',
  pf2: 'PF(2)',
  pf3: 'PF(3)',
  pf4: 'PF(4)',
  pf5: 'PF(5)',
  pf6: 'PF(6)',
  pf7: 'PF(7)',
  pf8: 'PF(8)',
  pf9: 'PF(9)',
  pf10: 'PF(10)',
  pf11: 'PF(11)',
  pf12: 'PF(12)',
  pf13: 'PF(13)',
  pf14: 'PF(14)',
  pf15: 'PF(15)',
  pf16: 'PF(16)',
  pf17: 'PF(17)',
  pf18: 'PF(18)',
  pf19: 'PF(19)',
  pf20: 'PF(20)',
  pf21: 'PF(21)',
  pf22: 'PF(22)',
  pf23: 'PF(23)',
  pf24: 'PF(24)',
};

export type X3270ExecutorOptions = B3270Options;

/**
 * The terminal surface, driven through x3270.
 *
 * Note what is absent: nothing here searches a screen. `screen()` reports what
 * the host is showing and the runtime resolves the step's address against it, so
 * "which field did this step mean" stays workflow semantics rather than
 * something an executor decides (ADR-008, ADR-018).
 */
export function createX3270ExecutorFactory(options: X3270ExecutorOptions = {}) {
  return {
    open(): Promise<TerminalExecutor> {
      return Promise.resolve(createExecutor(new B3270Session(options)));
    },
  };
}

function createExecutor(session: B3270Session): TerminalExecutor {
  /** Screens captured through the run, kept as the surface's evidence. */
  const captured: string[] = [];

  async function currentScreen(): Promise<Screen> {
    const result = await session.run('ReadBuffer', ['Ascii']);

    if (!result.ok) {
      throw new RuntimeError({
        code: 'TERMINAL_TIMEOUT',
        message: 'The terminal did not report its screen.',
        details: [{ field: 'emulator', message: result.message }],
      });
    }

    return parseReadBuffer(result.text, null);
  }

  return {
    async connect(request: TerminalConnectRequest): Promise<void> {
      const result = await session.run('Connect', [request.host]);

      if (!result.ok) {
        throw new RuntimeError({
          code: 'TERMINAL_CONNECT_FAILED',
          message: 'The terminal session could not be opened.',
          // The host is Orbit-declared and safe to report. The emulator's own
          // message is not persisted: it can carry host banner text.
          details: [{ field: 'host', message: request.host }],
        });
      }
    },

    screen: currentScreen,

    async typeAt(request: TerminalTypeRequest): Promise<void> {
      const move = await session.run('MoveCursor', [
        String(request.position.row),
        String(request.position.column),
      ]);

      if (!move.ok) {
        throw new RuntimeError({
          code: 'FIELD_NOT_FOUND',
          message: 'The terminal would not place the cursor where the step expected.',
        });
      }

      const typed = await session.run('String', [request.value]);

      if (!typed.ok) {
        // A protected field is the usual cause, and it is a real workflow
        // failure: the screen is not the one this step was written against.
        throw new RuntimeError({
          code: 'UNEXPECTED_SCREEN',
          message: 'The terminal refused input at the position this step names.',
        });
      }
    },

    async press(request: TerminalPressRequest): Promise<void> {
      const result = await session.run(AID_ACTIONS[request.key]);

      if (!result.ok) {
        throw new RuntimeError({
          code: 'TERMINAL_TIMEOUT',
          message: `The terminal did not accept "${request.key}".`,
        });
      }

      // The host has the keyboard until it finishes responding. This is the
      // protocol's own settled signal rather than a timeout heuristic.
      await session.run('Wait', [String(Math.ceil(request.timeoutMs / 1000)), 'Unlock']);
      captured.push(renderScreen(await currentScreen()));
    },

    finishEvidence(): Promise<readonly SurfaceEvidence[]> {
      return Promise.resolve(
        captured.length === 0
          ? []
          : [
              {
                kind: 'terminal_screen' as const,
                role: 'screen_after_action' as const,
                bytes: new TextEncoder().encode(captured.join('\n\n')),
              },
            ],
      );
    },

    close(): Promise<void> {
      return session.close();
    },
  };
}

/**
 * A screen as storable text, with non-display fields masked.
 *
 * Masked from the field attribute rather than from a guess about the label. A
 * non-display field still transmits in clear, so this is where the redaction has
 * to happen -- the wire does not do it (ADR-038).
 */
export function renderScreen(screen: Screen): string {
  const lines: string[] = [];

  for (const field of screen.fields) {
    const text = field.attributes.nonDisplay ? '[redacted]' : field.text;
    lines.push(`${String(field.start.row)},${String(field.start.column)}: ${text}`);
  }

  return lines.join('\n');
}
