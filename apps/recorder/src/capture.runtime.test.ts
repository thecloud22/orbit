import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { compareFingerprint } from '@orbit/execution-mapping';
import { openRecordingSession, type RecordingSession } from '@orbit/execution-recorder';
import { createPlaywrightExecutorFactory } from '@orbit/executor-playwright';
import type { BrowserExecutor } from '@orbit/runtime';
import { translateRecording, type RecordedEntry } from '@orbit/sop-recording';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * The capture engine against a real browser, and the contract it owes 4a.
 *
 * The parity test below is the one that matters most in this task. A binding is
 * recorded here and compared at run time by `describeElement`, which 4a froze
 * and this task may not touch — so two independent implementations must derive
 * the same fingerprint from the same element. If they ever disagree, every
 * binding drifts on its first real run, which would look exactly like the drift
 * check working and would actually be this task being wrong.
 *
 * Sharing the code is not available. Proving they agree is.
 */
const DEMO_PORTAL_URL = 'http://localhost:3001/requests';

let session: RecordingSession | undefined;
let executor: BrowserExecutor | undefined;

afterEach(async () => {
  await session?.close();
  session = undefined;
  await executor?.close();
  executor = undefined;
});

/** Headless here only because the "human" is Playwright driving the same page. */
async function record(mode: 'action' | 'pick' = 'action'): Promise<RecordingSession> {
  session = await openRecordingSession({ startUrl: DEMO_PORTAL_URL, mode, headless: true });
  return session;
}

async function settle(active: RecordingSession, expected = 1): Promise<void> {
  await expect
    .poll(() => active.captures().length + active.failures().length, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(expected);
}

describe('capturing a click', () => {
  it('derives a verified selector chain and a fingerprint', async () => {
    const active = await record();

    await active.page().getByTestId('search-request-button').click();
    await settle(active);

    const capture = active.captures()[0];
    expect(capture).toBeDefined();
    expect(capture?.type).toBe('click');

    // Most robust first, and every entry was checked to resolve uniquely to
    // this element rather than merely to exist.
    expect(capture?.selectors[0]).toEqual({
      strategy: 'test_id',
      value: 'search-request-button',
    });
    expect(capture?.selectors.length).toBeGreaterThan(1);

    expect(capture?.fingerprint.role).toBe('button');
    expect(capture?.fingerprint.accessibleName).toBe('Search');
  });

  it('offers no CSS or XPath, whatever the page looks like', async () => {
    const active = await record();

    await active.page().getByTestId('search-request-button').click();
    await settle(active);

    const strategies = active.captures()[0]?.selectors.map((locator) => locator.strategy) ?? [];
    expect(
      strategies.every((strategy) => ['test_id', 'role_and_name', 'label'].includes(strategy)),
    ).toBe(true);
  });

  it('removes its own marker from the page', async () => {
    const active = await record();

    await active.page().getByTestId('search-request-button').click();
    await settle(active);

    // The token is scaffolding. Left behind it would be a stray attribute on a
    // real page and could confuse a later capture.
    await expect
      .poll(() => active.page().locator('[data-orbit-capture]').count(), { timeout: 5_000 })
      .toBe(0);
  });
});

describe('capturing a fill', () => {
  it('captures the field and the typed value', async () => {
    const active = await record();

    await active.page().getByTestId('request-number-input').fill('SR-1001');
    await active.page().getByTestId('request-number-input').blur();
    await settle(active);

    const capture = active.captures().find((entry) => entry.type === 'fill');

    expect(capture?.typedValue).toBe('SR-1001');
    expect(capture?.fingerprint.role).toBe('textbox');
    expect(capture?.fingerprint.accessibleName).toBe('Service request number');
  });
});

describe('pick mode', () => {
  it('captures a value to read without letting the page act', async () => {
    const active = await record('pick');

    // Clicking Search in pick mode must not run the search: an extract step
    // should never fire the page's handlers just because someone pointed at it.
    await active.page().getByTestId('request-number-input').fill('SR-1001');
    await active.page().getByTestId('search-request-button').click();
    await settle(active);

    expect(active.captures().some((capture) => capture.type === 'pick')).toBe(true);
    expect(await active.page().getByTestId('request-result').count()).toBe(0);
  });
});

describe('fingerprint parity with the runtime drift check', () => {
  async function describedByRuntime(testId: string) {
    executor = await createPlaywrightExecutorFactory({ headless: true }).open();
    await executor.navigate({ url: DEMO_PORTAL_URL, timeoutMs: 30_000 });
    return executor.describeElement({
      locator: { strategy: 'test_id', value: testId },
      timeoutMs: 15_000,
    });
  }

  it('agrees on an action target', async () => {
    const active = await record();
    await active.page().getByTestId('search-request-button').click();
    await settle(active);

    const recorded = active.captures()[0]?.fingerprint;
    expect(recorded).toBeDefined();

    const observed = await describedByRuntime('search-request-button');

    // The contract between 4a and 4b, asserted rather than assumed.
    expect(compareFingerprint(recorded!, observed, 'action')).toEqual({ matches: true });
  });

  it('agrees on a read target', async () => {
    // Recorded the way a person would: run the search in action mode, then
    // switch to pick mode to point at the value. The switch must not reload,
    // or the result being pointed at would vanish.
    const active = await record('action');

    await active.page().getByTestId('request-number-input').fill('SR-1001');
    await active.page().getByTestId('search-request-button').click();
    await active.page().getByTestId('request-status').waitFor({ state: 'visible' });

    await active.setMode('pick');
    active.clearCaptures();

    // The page survived the mode switch.
    expect(await active.page().getByTestId('request-status').count()).toBe(1);

    await active.page().getByTestId('request-status').click();
    await settle(active);

    const capture = active.captures()[0];
    expect(capture?.type).toBe('pick');
    expect(capture?.fingerprint.role).toBe('definition');

    const observer = await createPlaywrightExecutorFactory({ headless: true }).open();
    executor = observer;
    await observer.navigate({ url: DEMO_PORTAL_URL, timeoutMs: 30_000 });
    await observer.fill({
      locator: { strategy: 'test_id', value: 'request-number-input' },
      value: 'SR-1001',
      timeoutMs: 15_000,
    });
    await observer.click({
      locator: { strategy: 'test_id', value: 'search-request-button' },
      timeoutMs: 15_000,
    });

    const observed = await observer.describeElement({
      locator: { strategy: 'test_id', value: 'request-status' },
      timeoutMs: 15_000,
    });

    // `read` mode: identity must agree, and the text deliberately need not —
    // that text is the value being extracted and changes every run.
    expect(compareFingerprint(capture!.fingerprint, observed, 'read')).toEqual({ matches: true });
  });
});

/**
 * Interactions that navigate, which is most of a real workflow.
 *
 * These use a throwaway local page rather than the demo portal on purpose: the
 * portal re-renders in place and never navigates, which is exactly why the
 * defect these cover survived every existing test. A click that submits a form
 * or follows a link tears down the document — and the execution context
 * derivation runs in — so a passively-observed capture was discarded before it
 * could be derived, and the step was recorded as nothing at all.
 */
describe('interactions that navigate', () => {
  const NAVIGATING_PAGE = `<!doctype html><html><body>
    <form method="GET" action="/next">
      <label for="q">Search term</label>
      <input id="q" name="q" data-testid="q" />
      <label for="dept">Department</label>
      <select id="dept" name="dept" data-testid="dept">
        <option value="">Choose…</option>
        <option value="infra">Infrastructure</option>
      </select>
      <button type="submit" data-testid="go">Go</button>
    </form>
    <a href="/next" data-testid="link">Next page</a>
  </body></html>`;

  const NEXT_PAGE = `<!doctype html><html><body><h1 data-testid="done">Next</h1></body></html>`;

  let server: Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  async function pageServer(): Promise<string> {
    const started = createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(request.url?.startsWith('/next') ? NEXT_PAGE : NAVIGATING_PAGE);
    });
    server = started;

    await new Promise<void>((resolve) => started.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(started.address() as AddressInfo).port}/`;
  }

  async function recordAt(url: string): Promise<RecordingSession> {
    session = await openRecordingSession({ startUrl: url, mode: 'action', headless: true });
    return session;
  }

  it('keeps the fill and the click when the submit navigates away', async () => {
    const active = await recordAt(await pageServer());

    await active.page().getByTestId('q').fill('hello');
    await active.page().getByTestId('go').click();
    await active.page().waitForURL(/next/);
    await settle(active, 2);

    const kinds = active.captures().map((capture) => capture.type);

    expect(kinds).toContain('fill');
    expect(kinds).toContain('click');
    expect(active.captures().find((capture) => capture.type === 'fill')?.typedValue).toBe('hello');

    // Held back, not cancelled: the navigation must still have happened.
    expect(active.page().url()).toContain('/next');
  });

  it('keeps a link click that navigates away', async () => {
    const active = await recordAt(await pageServer());

    await active.page().getByTestId('link').click();
    await active.page().waitForURL(/next/);
    await settle(active);

    expect(active.captures().map((capture) => capture.type)).toContain('click');
    expect(active.page().url()).toContain('/next');
  });

  it('keeps a field submitted with the Enter key, which produces no click', async () => {
    const active = await recordAt(await pageServer());

    await active.page().getByTestId('q').fill('typed-then-enter');
    await active.page().getByTestId('q').press('Enter');
    await active.page().waitForURL(/next/);
    await settle(active);

    expect(active.captures().find((capture) => capture.type === 'fill')?.typedValue).toBe(
      'typed-then-enter',
    );
    expect(active.page().url()).toContain('/next');
  });

  it('captures a dropdown selection as a fill of the chosen value', async () => {
    const active = await recordAt(await pageServer());

    await active.page().getByTestId('dept').selectOption('infra');
    await settle(active);

    const capture = active.captures().find((entry) => entry.type === 'fill');

    expect(capture?.typedValue).toBe('infra');
    expect(capture?.fingerprint.role).toBe('combobox');
  });
});

/**
 * The whole point of capturing a field: it has to survive into the agent.
 *
 * A capture that never becomes a `browser.fill` step is indistinguishable from
 * not capturing it at all, so this follows one typed input through the real
 * browser, the real translator, and the real compiler to the executable step.
 */
describe('a typed field reaches the compiled agent', () => {
  it('becomes a browser.fill step carrying what was typed', async () => {
    const active = await record();

    await active.page().getByTestId('request-number-input').fill('SR-1001');
    await active.page().getByTestId('search-request-button').click();
    await settle(active, 2);

    const entries: RecordedEntry[] = [];
    for (const entry of active.sequence()) {
      if (entry.type === 'navigate') {
        entries.push({ kind: 'navigate', url: entry.url });
      } else if (entry.type !== 'pick') {
        entries.push({
          kind: entry.type,
          selectors: entry.selectors,
          fingerprint: entry.fingerprint,
          ...(entry.typedValue === undefined ? {} : { typedValue: entry.typedValue }),
          ...(entry.sensitive ? { sensitive: true } : {}),
        });
      }
    }

    const translated = translateRecording({ title: 'Find a service request', sequence: entries });
    expect(translated.ok).toBe(true);
    if (!translated.ok) {
      return;
    }

    const fillStep = translated.steps.find((step) => step.step.kind === 'fill');
    expect(fillStep, 'the recording produced no fill step').toBeDefined();

    // The binding is what makes the step executable, and it must name the field
    // the person actually typed into.
    expect(fillStep?.binding?.kind).toBe('fill');
    expect(
      JSON.stringify(fillStep?.binding).includes('request-number-input'),
      'the fill binding does not target the field that was typed into',
    ).toBe(true);
  });
});
