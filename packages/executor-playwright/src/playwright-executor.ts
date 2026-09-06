import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RuntimeError } from '@orbit/runtime';
import type {
  BrowserExecutor,
  BrowserExecutorFactory,
  ClickRequest,
  ElementDescription,
  FillRequest,
  LocatorRequest,
  NavigateRequest,
  NavigateResult,
  TextRequest,
  WaitForTextResult,
} from '@orbit/runtime';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import { parseAriaSnapshotHeader } from '@orbit/execution-mapping';

import { classifyLocatorFailure, classifyNavigationFailure } from './errors';
import { resolveLocator } from './locator';

/**
 * The Playwright implementation of the runtime's browser capability interface.
 *
 * It performs approved actions and classifies its own failures. It does not
 * decide workflow order, evaluate assertions as business logic, or determine a
 * business outcome — those belong to the runtime (ADR-008).
 *
 * Waiting is Playwright's own actionability throughout. The one exception is
 * text assertion, which polls: `playwright` (unlike `@playwright/test`) ships no
 * retrying `expect`, and a test-runner assertion library has no place in
 * production runtime code. The poll is bounded by the step's own deadline and is
 * not a fixed sleep standing in for a wait.
 */

const TEXT_POLL_INTERVAL_MS = 100;

/** Traces are written to a temp file and read back; nothing is written into the repository. */
const TRACE_DIRECTORY_PREFIX = 'orbit-trace-';

export interface PlaywrightExecutorOptions {
  /** Headed mode is for developer debugging only; headless is the safe default. */
  readonly headless?: boolean;
  readonly viewport?: { readonly width: number; readonly height: number };
}

const DEFAULT_VIEWPORT = { width: 1280, height: 800 } as const;

export function createPlaywrightExecutorFactory(
  options: PlaywrightExecutorOptions = {},
): BrowserExecutorFactory {
  return {
    async open(): Promise<BrowserExecutor> {
      const browser = await chromium.launch({ headless: options.headless ?? true });

      let context: BrowserContext;
      try {
        context = await browser.newContext({ viewport: options.viewport ?? DEFAULT_VIEWPORT });
      } catch (error) {
        await browser.close().catch(() => undefined);
        throw error;
      }

      try {
        // Started before the first action so the trace covers the whole run,
        // including a failure in the very first step. `sources: false` keeps
        // repository source files out of evidence bytes.
        await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
        const page = await context.newPage();
        return createExecutor(browser, context, page);
      } catch (error) {
        await context.close().catch(() => undefined);
        await browser.close().catch(() => undefined);
        throw error;
      }
    },
  };
}

function createExecutor(browser: Browser, context: BrowserContext, page: Page): BrowserExecutor {
  let traceFinished = false;

  return {
    async navigate(request: NavigateRequest): Promise<NavigateResult> {
      try {
        const response = await page.goto(request.url, {
          timeout: request.timeoutMs,
          waitUntil: 'load',
        });

        return { url: page.url(), httpStatus: response?.status() ?? null };
      } catch (error) {
        throw classifyNavigationFailure(error, { url: request.url, timeoutMs: request.timeoutMs });
      }
    },

    async fill(request: FillRequest): Promise<void> {
      try {
        await resolveLocator(page, request.locator).fill(request.value, {
          timeout: request.timeoutMs,
        });
      } catch (error) {
        throw classifyLocatorFailure(error, {
          locator: request.locator,
          action: 'fill',
          timeoutMs: request.timeoutMs,
        });
      }
    },

    async click(request: ClickRequest): Promise<void> {
      try {
        await resolveLocator(page, request.locator).click({ timeout: request.timeoutMs });
      } catch (error) {
        throw classifyLocatorFailure(error, {
          locator: request.locator,
          action: 'click',
          timeoutMs: request.timeoutMs,
        });
      }
    },

    async waitForVisible(request: LocatorRequest): Promise<void> {
      try {
        await resolveLocator(page, request.locator).waitFor({
          state: 'visible',
          timeout: request.timeoutMs,
        });
      } catch (error) {
        throw classifyLocatorFailure(error, {
          locator: request.locator,
          action: 'wait for visible',
          timeoutMs: request.timeoutMs,
        });
      }
    },

    async isVisible(request: { readonly locator: LocatorRequest['locator'] }): Promise<boolean> {
      // A single non-waiting probe: this exists to detect two known UI states
      // being present at once, so waiting would defeat its purpose.
      return resolveLocator(page, request.locator).isVisible();
    },

    async waitForText(request: TextRequest): Promise<WaitForTextResult> {
      const deadline = Date.now() + request.timeoutMs;
      const locator = resolveLocator(page, request.locator);

      try {
        await locator.waitFor({ state: 'visible', timeout: request.timeoutMs });
      } catch {
        // A locator that never appears is a failed assertion, not a lookup
        // failure: the runtime reports what was expected and what was seen.
        return { matched: false, observed: null };
      }

      for (;;) {
        let observed: string | null;

        try {
          observed = (await locator.innerText()).trim();
        } catch {
          observed = null;
        }

        if (observed === request.expected) {
          return { matched: true, observed };
        }

        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          return { matched: false, observed };
        }

        await delay(Math.min(TEXT_POLL_INTERVAL_MS, remaining));
      }
    },

    async readText(request: LocatorRequest): Promise<string> {
      const locator = resolveLocator(page, request.locator);

      try {
        await locator.waitFor({ state: 'visible', timeout: request.timeoutMs });
        return (await locator.innerText()).trim();
      } catch (error) {
        throw classifyLocatorFailure(error, {
          locator: request.locator,
          action: 'read text',
          timeoutMs: request.timeoutMs,
        });
      }
    },

    /**
     * Describes an element as the accessibility tree sees it.
     *
     * Read-only, and used by the runtime's drift check before a real action —
     * this executor makes no judgement about what the answer means.
     *
     * Every field comes from a first-class Playwright API. There is deliberately
     * no `evaluate` here and no `tagName`: reading a tag name or an implicit
     * role from the DOM requires injecting script, and `ariaSnapshot` reports
     * the *computed* role and accessible name without it. That matters in
     * practice, not just in principle — real controls almost never carry an
     * explicit `role` attribute, so reading the attribute alone would leave the
     * role empty for most elements and gut the drift signal (ADR-018).
     */
    async describeElement(request: LocatorRequest): Promise<ElementDescription> {
      const locator = resolveLocator(page, request.locator);

      try {
        await locator.waitFor({ state: 'visible', timeout: request.timeoutMs });
      } catch (error) {
        throw classifyLocatorFailure(error, {
          locator: request.locator,
          action: 'describe element',
          timeoutMs: request.timeoutMs,
        });
      }

      // Only the first line of the snapshot describes the target itself; the
      // rest is its subtree, which for a container includes values that change
      // every run.
      const snapshot = await locator.ariaSnapshot({ depth: 0 });
      const { role, accessibleName } = parseAriaSnapshotHeader(snapshot);

      let text: string | null;
      try {
        text = (await locator.innerText()).trim();
      } catch {
        text = null;
      }

      return {
        role,
        accessibleName,
        text,
        boundingBox: await locator.boundingBox(),
      };
    },

    async captureScreenshot(): Promise<Uint8Array> {
      return page.screenshot({ type: 'png', fullPage: true });
    },

    async captureDom(): Promise<string> {
      return page.content();
    },

    async finishTrace(): Promise<Uint8Array> {
      if (traceFinished) {
        throw new RuntimeError({
          code: 'INTERNAL_ERROR',
          message: 'The Playwright trace for this run has already been finished.',
        });
      }
      traceFinished = true;

      const directory = await mkdtemp(join(tmpdir(), TRACE_DIRECTORY_PREFIX));
      const path = join(directory, 'trace.zip');

      try {
        await context.tracing.stop({ path });
        return await readFile(path);
      } finally {
        await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      }
    },

    async close(): Promise<void> {
      // Each close is independent: a failure to close the context must not leave
      // a browser process behind.
      try {
        await context.close();
      } finally {
        await browser.close();
      }
    },
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
