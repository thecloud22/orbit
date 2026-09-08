import type { ElementFingerprint, SelectorChain } from '@orbit/execution-mapping';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import {
  capturedElement,
  deriveTarget,
  NoUsableSelectorError,
  type DerivedTarget,
  type ResolvedSelector,
} from './derive';
import {
  buildInjectedScript,
  CAPTURE_ATTRIBUTE,
  CAPTURE_BINDING,
  MODE_GLOBAL,
  type CaptureMode,
  type RawCapture,
} from './injected';

/**
 * One recording session: a headed browser a human actually uses.
 *
 * Headed is not a preference. The whole method is a person demonstrating a step
 * once, so they must be able to see and click the page. Everything they do is
 * real — real clicks, real fills, real navigation — against a sandbox and never
 * anywhere else.
 *
 * The session outlives a single capture on purpose: mapping a workflow means
 * recording several steps in sequence, and each one starts wherever the last
 * left the browser. Restarting from a blank page for every step would make
 * anything past a sign-in impossible to reach.
 */

export interface CapturedAction {
  readonly id: string;
  readonly type: 'click' | 'fill' | 'pick';
  /**
   * For a fill: what the human typed. Shown to verify, then discarded.
   *
   * Always absent for a password field — its value never enters this process.
   */
  readonly typedValue: string | undefined;
  /** The field was a password input, so no value was read from it. */
  readonly sensitive: boolean;
  readonly selectors: SelectorChain;
  readonly fingerprint: ElementFingerprint;
  readonly considered: readonly ResolvedSelector[];
  /** Where the page was when this happened. */
  readonly url: string;
  readonly capturedAt: Date;
}

/**
 * A page change, which is part of the sequence rather than an aside.
 *
 * Without it a recording is a list of clicks with no record of where each one
 * happened, and a workflow compiled from it would start mid-flow.
 */
export interface CapturedNavigation {
  readonly id: string;
  readonly type: 'navigate';
  readonly url: string;
  readonly capturedAt: Date;
}

/** One entry in the recording, in the order it happened. */
export type SequenceEntry = (CapturedAction | CapturedNavigation) & { readonly order: number };

export interface CaptureFailure {
  readonly id: string;
  readonly reason: string;
  readonly considered: readonly ResolvedSelector[];
  readonly url: string;
}

export interface RecordingSession {
  /**
   * The page the human is working in.
   *
   * Exposed deliberately. ADR-008's narrow-capability rule constrains the
   * *runtime*, which must never be able to do more to a browser than execute an
   * approved step; this package is the opposite thing — a tool a person drives
   * directly, which already injects script by design. Hiding the page here
   * would buy no safety and would make the capture engine untestable, since a
   * test has to perform the interactions a human performs in production.
   */
  page(): Page;
  /**
   * Whether the browser this session drives is gone.
   *
   * A person can close the window Orbit opened, and nothing stops them —
   * it is their browser. Without this, the first call after that closure
   * reaches `page.evaluate` on a dead page and throws `TargetClosedError`
   * from inside a registry whose every other outcome is a typed refusal,
   * so a closed window surfaced as a 500 rather than as "that window is
   * gone, start again".
   */
  isClosed(): boolean;
  /** Switches between performing an action and picking an element to read. */
  setMode(mode: CaptureMode): Promise<void>;
  navigate(url: string): Promise<void>;
  currentUrl(): string;
  /**
   * Element interactions captured so far, newest last.
   *
   * Navigations are excluded: a caller choosing which element a step acts on
   * has no use for them. The whole recording, in order, is `sequence()`.
   */
  captures(): readonly CapturedAction[];
  /** Everything captured, navigations included, in the order it happened. */
  sequence(): readonly SequenceEntry[];
  /** Captures that could not be turned into a usable selector. */
  failures(): readonly CaptureFailure[];
  clearCaptures(): void;
  close(): Promise<void>;
}

export interface OpenSessionOptions {
  readonly startUrl: string;
  readonly mode?: CaptureMode;
  /** Headless only for tests, which drive the "human" with Playwright itself. */
  readonly headless?: boolean;
  readonly onCapture?: (capture: CapturedAction) => void;
  readonly onFailure?: (failure: CaptureFailure) => void;
}

export async function openRecordingSession(options: OpenSessionOptions): Promise<RecordingSession> {
  const browser: Browser = await chromium.launch({ headless: options.headless ?? false });

  let context: BrowserContext;
  try {
    context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw error;
  }

  const captures: CapturedAction[] = [];
  const navigations: CapturedNavigation[] = [];
  const ordering = new Map<string, number>();
  const failures: CaptureFailure[] = [];
  let sequence = 0;
  let order = 0;
  /**
   * Which round of capturing a result belongs to.
   *
   * Deriving a target is asynchronous — a handful of round trips to the page —
   * so a capture reported just before `clearCaptures` can finish deriving just
   * after it, and land in the next step's list. That is not hypothetical: it
   * showed up as a previous step's click appearing as the current step's
   * capture. Anything derived under a stale generation is dropped.
   */
  let generation = 0;
  let page: Page;

  try {
    page = await context.newPage();

    // The single channel from the page. Everything it sends is treated as a
    // hint about *which* element, never as a description of it: the token is
    // looked up and re-derived here, so a page that lied about a role or a name
    // would change nothing.
    await context.exposeBinding(CAPTURE_BINDING, async (source, raw: unknown) => {
      const capture = raw as RawCapture & { readonly url?: string };

      if (typeof capture?.token !== 'string') {
        return;
      }

      sequence += 1;
      const id = `capture-${sequence}`;
      const observedGeneration = generation;

      // A navigation names no element, so there is nothing to derive: it is
      // recorded as it arrives.
      if (capture.type === 'navigate') {
        if (observedGeneration !== generation) {
          return;
        }

        const entry: CapturedNavigation = {
          id,
          type: 'navigate',
          url: typeof capture.url === 'string' ? capture.url : source.page.url(),
          capturedAt: new Date(),
        };

        // Consecutive duplicates are noise: a single page load can announce
        // itself more than once, and a workflow does not navigate twice to
        // somewhere it already is.
        if (navigations.at(-1)?.url !== entry.url) {
          order += 1;
          ordering.set(entry.id, order);
          navigations.push(entry);
        }

        return;
      }

      try {
        const derived: DerivedTarget = await deriveTarget(source.page, capture.token);

        const entry: CapturedAction = {
          id,
          type: capture.type,
          typedValue: typeof capture.typedValue === 'string' ? capture.typedValue : undefined,
          sensitive: capture.sensitive === true,
          selectors: derived.selectors,
          fingerprint: derived.fingerprint,
          considered: derived.considered,
          url: source.page.url(),
          capturedAt: new Date(),
        };

        if (observedGeneration !== generation) {
          return;
        }

        order += 1;
        ordering.set(entry.id, order);
        captures.push(entry);
        options.onCapture?.(entry);
      } catch (error) {
        const failure: CaptureFailure = {
          id,
          reason:
            error instanceof NoUsableSelectorError
              ? error.message
              : `That element could not be captured: ${error instanceof Error ? error.message : String(error)}`,
          considered: error instanceof NoUsableSelectorError ? error.considered : [],
          url: source.page.url(),
        };

        if (observedGeneration !== generation) {
          return;
        }

        failures.push(failure);
        options.onFailure?.(failure);
      } finally {
        // The token is scaffolding, not evidence. Left in place it would be a
        // stray attribute on a real page and could confuse a later capture.
        await capturedElement(source.page, capture.token)
          .evaluate((element, attribute) => {
            element.removeAttribute(attribute);
          }, CAPTURE_ATTRIBUTE)
          .catch(() => undefined);
      }
    });

    await installScript(context, options.mode ?? 'action');
    await page.goto(options.startUrl, { waitUntil: 'load' });
  } catch (error) {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    throw error;
  }

  return {
    page() {
      return page;
    },

    isClosed() {
      // The page is what every call here touches, so it is what decides.
      // Closing the window closes the page even when the browser process
      // lingers, and closing the browser closes the page too.
      return page.isClosed();
    },

    async setMode(mode) {
      // Set in place, never by reloading. Mapping a workflow means recording
      // several steps deep into a flow, so a mode switch that threw away the
      // page would make everything past a sign-in unreachable.
      await page.evaluate(
        ([key, value]) => {
          (globalThis as unknown as Record<string, unknown>)[key as string] = value;
        },
        [MODE_GLOBAL, mode],
      );

      // Also re-injected, so a later navigation starts in the same mode.
      await installScript(context, mode);
    },

    async navigate(url) {
      await page.goto(url, { waitUntil: 'load' });
    },

    currentUrl() {
      return page.url();
    },

    captures() {
      return captures;
    },

    sequence() {
      return [...captures, ...navigations]
        .map((entry) => ({ ...entry, order: ordering.get(entry.id) ?? 0 }))
        .sort((left, right) => left.order - right.order);
    },

    failures() {
      return failures;
    },

    clearCaptures() {
      // Bumped first: anything still deriving belongs to the round being
      // discarded, and must not reappear in the next one.
      generation += 1;
      captures.length = 0;
      navigations.length = 0;
      ordering.clear();
      failures.length = 0;
    },

    async close() {
      try {
        await context.close();
      } finally {
        await browser.close();
      }
    },
  };
}

/**
 * Installs the listener, and sets the mode a fresh document starts in.
 *
 * Playwright cannot remove an init script, so the guard inside the script is
 * what keeps a re-injection from stacking two listeners; only the mode variable
 * is re-assigned.
 */
async function installScript(context: BrowserContext, mode: CaptureMode): Promise<void> {
  await context.addInitScript(buildInjectedScript(mode));
}
