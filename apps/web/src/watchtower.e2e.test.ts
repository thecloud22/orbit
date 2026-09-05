import { E2E_API_URL, E2E_WATCHTOWER_URL } from '@orbit/api/testing/stack-ports';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The Task 7-8 proof: a person starts a run in Watchtower and inspects the
 * evidence it produced.
 *
 * The whole stack is real — browser, Watchtower, API, runtime, Playwright,
 * demo portal, PostgreSQL, artifact storage. The API under test is the one the
 * global setup started against `orbit_test` and a disposable artifact root, so
 * nothing here touches development data.
 */
const TERMINAL_LABELS = ['Succeeded', 'Failed', 'Cancelled'];

describe('Watchtower end to end', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser.close();
  });

  async function open(path = '/'): Promise<Page> {
    const page = await browser.newPage();
    await page.goto(`${E2E_WATCHTOWER_URL}${path}`, { waitUntil: 'load' });
    return page;
  }

  /** Waits for the status panel to show a terminal label from the server. */
  async function waitForTerminal(page: Page): Promise<string> {
    const label = page.getByTestId('run-status-label');

    await expect
      .poll(
        async () => {
          const text = (await label.textContent()) ?? '';
          return TERMINAL_LABELS.some((terminal) => text.startsWith(terminal));
        },
        { timeout: 90_000, interval: 500 },
      )
      .toBe(true);

    return (await label.textContent()) ?? '';
  }

  async function startRun(page: Page, requestNumber: string): Promise<void> {
    await page.getByTestId('agent-name').waitFor({ state: 'visible' });
    await page.getByTestId('request-number-field').fill(requestNumber);
    await page.getByTestId('start-run-button').click();
  }

  it('starts SR-1001, reaches a succeeded run, and shows its output', async () => {
    const page = await open();

    await expect
      .poll(async () => page.getByTestId('agent-name').textContent())
      .toContain('Find Service Request');

    await startRun(page, 'SR-1001');

    // The button is disabled while the request is in flight, which is the UI
    // guard against a double submission.
    await page.getByTestId('run-status-panel').waitFor({ state: 'visible', timeout: 30_000 });

    const label = await waitForTerminal(page);
    expect(label).toContain('Succeeded');
    expect(label).toContain('request found');

    expect(await page.getByTestId('run-business-outcome').textContent()).toBe('request_found');
    expect(await page.getByTestId('run-id').textContent()).toMatch(/^run_/);
    expect(await page.getByTestId('run-agent-version').textContent()).toContain('0.1.0');

    expect(await page.getByTestId('output-requestNumber').textContent()).toBe('SR-1001');
    expect(await page.getByTestId('output-requestStatus').textContent()).toBe('In Progress');
    expect(await page.getByTestId('output-assignedTeam').textContent()).toBe(
      'Infrastructure Operations',
    );

    await expect.poll(async () => page.getByTestId('run-error').count()).toBe(0);

    await page.close();
  });

  it('shows the ordered step and event timeline', async () => {
    const page = await open();
    await startRun(page, 'SR-1001');
    await waitForTerminal(page);

    const steps = await page.getByTestId('step-row').allTextContents();
    expect(steps).toHaveLength(7);
    expect(steps[0]).toContain('open_request_portal');
    expect(steps.at(-1)).toContain('complete_found');

    expect(await page.getByTestId('step-status-complete_found').textContent()).toBe('succeeded');

    const events = await page.getByTestId('event-row').allTextContents();
    expect(events.length).toBeGreaterThan(20);
    expect(events[0]).toContain('run.queued');
    expect(events.at(-1)).toContain('run.completed');

    await page.close();
  });

  it('makes screenshot, HTML snapshot, and trace evidence accessible', async () => {
    const page = await open();
    await startRun(page, 'SR-1001');
    await waitForTerminal(page);

    const rows = await page.getByTestId('evidence-row').count();
    expect(rows).toBeGreaterThanOrEqual(3);

    const labels = await page.getByTestId('evidence-label').allTextContents();
    expect(labels).toContain('Screenshot');
    expect(labels).toContain('HTML snapshot');
    expect(labels).toContain('Playwright trace');

    // The screenshot is fetched through the controlled route and rendered.
    await page.getByTestId('evidence-show-screenshot').first().click();
    const image = page.getByTestId('evidence-screenshot').first();
    await image.waitFor({ state: 'visible', timeout: 30_000 });
    expect(await image.getAttribute('src')).toMatch(/^blob:/);
    expect(await page.getByTestId('evidence-failure').count()).toBe(0);

    // The HTML snapshot and the trace are download links addressed by id.
    const domHref = await page
      .getByTestId('evidence-download-dom_snapshot')
      .first()
      .getAttribute('href');
    const traceHref = await page
      .getByTestId('evidence-download-browser_trace')
      .first()
      .getAttribute('href');

    expect(domHref).toMatch(/^\/v1\/runs\/run_[A-Z0-9]+\/artifacts\/art_[A-Z0-9]+$/);
    expect(traceHref).toMatch(/^\/v1\/runs\/run_[A-Z0-9]+\/artifacts\/art_[A-Z0-9]+$/);

    // Both really serve their bytes, as attachments.
    const dom = await fetch(`${E2E_API_URL}${domHref}`);
    expect(dom.status).toBe(200);
    expect(dom.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(dom.headers.get('content-disposition')).toContain('attachment');
    expect(await dom.text()).toContain('data-testid');

    const trace = await fetch(`${E2E_API_URL}${traceHref}`);
    expect(trace.status).toBe(200);
    expect(trace.headers.get('content-type')).toBe('application/zip');
    expect(new Uint8Array(await trace.arrayBuffer()).slice(0, 2)).toEqual(
      new Uint8Array([0x50, 0x4b]),
    );

    await page.close();
  });

  it('shows a not-found request as a business outcome, not a failure', async () => {
    const page = await open();
    await startRun(page, 'SR-9999');

    const label = await waitForTerminal(page);

    expect(label).toContain('Succeeded');
    expect(label).toContain('request not found');
    expect(await page.getByTestId('run-business-outcome').textContent()).toBe('request_not_found');
    expect(await page.getByTestId('run-error').count()).toBe(0);
    expect(await page.getByTestId('run-status-detail').textContent()).toContain('business outcome');

    await page.close();
  });

  it('rejects an empty request number with a field-level message and starts no run', async () => {
    const page = await open();
    await page.getByTestId('agent-name').waitFor({ state: 'visible' });
    await page.getByTestId('request-number-field').fill('');
    await page.getByTestId('start-run-button').click();

    await page.getByTestId('run-request-error').waitFor({ state: 'visible', timeout: 30_000 });

    expect(await page.getByTestId('run-request-error-message').textContent()).toContain('input');
    expect(await page.getByTestId('run-status-panel').count()).toBe(0);

    await page.close();
  });

  it('shows a controlled technical failure with its typed error and evidence', async () => {
    // The broken-locator Agent Version the global setup published. Started
    // through the API because Watchtower deliberately offers no version picker.
    const versions = (await (await fetch(`${E2E_API_URL}/v1/agent-versions`)).json()) as {
      data: { id: string; name: string }[];
    };
    const broken = versions.data.find((version) => version.name.includes('broken locator'));
    expect(broken).toBeDefined();

    const created = (await (
      await fetch(`${E2E_API_URL}/v1/agent-versions/${broken!.id}/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputs: { requestNumber: 'SR-1001' } }),
      })
    ).json()) as { data: { runId: string } };

    const page = await open(`/?runId=${created.data.runId}`);

    const label = await waitForTerminal(page);
    expect(label).toBe('Failed');

    expect(await page.getByTestId('run-error-code').textContent()).toBe('LOCATOR_NOT_FOUND');
    expect(await page.getByTestId('run-error-message').textContent()).not.toContain('call log');
    expect(await page.getByTestId('run-progress').textContent()).toContain(
      'failed at extract_request_data',
    );

    // A failed run still recorded evidence, and it is reachable.
    expect(await page.getByTestId('evidence-row').count()).toBeGreaterThan(0);
    const labels = await page.getByTestId('evidence-label').allTextContents();
    expect(labels).toContain('Playwright trace');

    const steps = await page.getByTestId('step-row').allTextContents();
    expect(steps.some((step) => step.includes('complete_found'))).toBe(false);

    await page.close();
  });
});
