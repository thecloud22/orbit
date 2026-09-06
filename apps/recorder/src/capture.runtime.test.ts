import { compareFingerprint } from '@orbit/execution-mapping';
import { openRecordingSession, type RecordingSession } from '@orbit/execution-recorder';
import { createPlaywrightExecutorFactory } from '@orbit/executor-playwright';
import type { BrowserExecutor } from '@orbit/runtime';
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
