import { createHash } from 'node:crypto';

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

  /**
   * One successful run, started through the API and shared by the read-only
   * safety checks below. Those assert properties of a finished run rather than
   * of the act of starting one, so paying for a browser run each is waste.
   */
  let sharedRun: { runId: string; detail: RunDetailBody } | undefined;

  interface ArtifactBody {
    readonly id: string;
    readonly kind: string;
    readonly sha256: string;
    readonly sizeBytes: number;
    readonly url: string;
  }

  interface RunDetailBody {
    readonly id: string;
    readonly status: string;
    readonly artifacts: readonly ArtifactBody[];
  }

  async function succeededRun(): Promise<{ runId: string; detail: RunDetailBody }> {
    if (sharedRun !== undefined) {
      return sharedRun;
    }

    const versions = (await (await fetch(`${E2E_API_URL}/v1/agent-versions`)).json()) as {
      data: { id: string; name: string }[];
    };
    const seeded = versions.data.find((version) => !version.name.includes('broken locator'));

    const created = (await (
      await fetch(`${E2E_API_URL}/v1/agent-versions/${seeded!.id}/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputs: { requestNumber: 'SR-1001' } }),
      })
    ).json()) as { data: { runId: string } };

    const runId = created.data.runId;

    await expect
      .poll(
        async () => {
          const summary = (await (
            await fetch(`${E2E_API_URL}/v1/runs/${runId}/summary`)
          ).json()) as { data: { status: string } };
          return summary.data.status;
        },
        { timeout: 90_000, interval: 500 },
      )
      .toBe('succeeded');

    const detail = (await (await fetch(`${E2E_API_URL}/v1/runs/${runId}`)).json()) as {
      data: RunDetailBody;
    };

    sharedRun = { runId, detail: detail.data };
    return sharedRun;
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

  describe('artifact access safety', () => {
    it('refuses an artifact requested under a different run', async () => {
      const { detail } = await succeededRun();

      const otherRun = (await (await fetch(`${E2E_API_URL}/v1/agent-versions`)).json()) as {
        data: { id: string; name: string }[];
      };
      const seeded = otherRun.data.find((version) => !version.name.includes('broken locator'));

      const second = (await (
        await fetch(`${E2E_API_URL}/v1/agent-versions/${seeded!.id}/runs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ inputs: { requestNumber: 'SR-9999' } }),
        })
      ).json()) as { data: { runId: string } };

      const borrowed = detail.artifacts[0]!;
      const response = await fetch(
        `${E2E_API_URL}/v1/runs/${second.data.runId}/artifacts/${borrowed.id}`,
      );

      expect(response.status).toBe(404);
      const body = await response.text();
      expect(body).not.toContain('/Users');
      expect(body).not.toContain('data/artifacts');
    });

    it('returns the same 404 for an artifact that does not exist', async () => {
      const { runId } = await succeededRun();

      // Well-formed but never issued.
      const response = await fetch(
        `${E2E_API_URL}/v1/runs/${runId}/artifacts/art_00000000000000000000000000`,
      );

      expect(response.status).toBe(404);
      expect((await response.json()).error.message).toBe('No such artifact for this run.');
    });

    it('never exposes a storage key or filesystem path in an API response', async () => {
      const { runId } = await succeededRun();

      for (const path of [`/v1/runs/${runId}`, `/v1/runs/${runId}/events`, '/v1/agent-versions']) {
        const body = await (await fetch(`${E2E_API_URL}${path}`)).text();

        expect(body, path).not.toContain('storageKey');
        expect(body, path).not.toContain('/Users');
        expect(body, path).not.toContain('data/artifacts');
        expect(body, path).not.toContain('/steps/rstep_');
      }
    });

    it('never renders a storage key or filesystem path in Watchtower', async () => {
      const { runId } = await succeededRun();
      const page = await open(`/?runId=${runId}`);
      await page.getByTestId('evidence-list').waitFor({ state: 'visible', timeout: 60_000 });

      // Orbit's own rendering, not the whole document: Vite's dev server injects
      // absolute source paths of its own into <head>, which says nothing about
      // what Watchtower publishes. Everything the application renders is here.
      const rendered = await page.locator('#root').innerHTML();

      expect(rendered).not.toContain('storageKey');
      expect(rendered).not.toContain('data/artifacts');
      expect(rendered).not.toContain('/Users');
      expect(rendered).not.toContain('/steps/rstep_');

      // These two are Orbit-specific strings that no build tool would inject, so
      // they are also checked against the entire document.
      const document = await page.content();
      expect(document).not.toContain('storageKey');
      expect(document).not.toContain('data/artifacts');

      await page.close();
    });
  });

  /**
   * Sub-phase 2.2, through the whole stack.
   *
   * The API serving these is the same production composition every other test
   * here uses; the one dependency substituted is the model provider, injected
   * by `apps/api/src/testing/e2e-server.ts` rather than selected by an
   * environment variable the shipped entry point could read.
   */
  describe('drafting a workflow from a description', () => {
    async function submit(page: Page, sourceText: string) {
      await page.getByTestId('sop-source-text').fill(sourceText);
      await page.getByTestId('generate-draft-button').click();
    }

    it('turns a description into a reviewable draft', async () => {
      const page = await open();

      await submit(page, 'Sign in to the portal, find the request, and review the escalation.');

      const draft = page.getByTestId('sop-draft');
      await expect.poll(() => draft.count(), { timeout: 30_000 }).toBe(1);

      await expect
        .poll(async () => (await page.getByTestId('sop-draft-title').textContent()) ?? '')
        .toContain('Service request escalation review');

      // The plain-language flow, not raw JSON.
      expect(await page.getByTestId('sop-draft-step').count()).toBeGreaterThan(5);
      expect(await page.getByTestId('sop-draft-question').count()).toBeGreaterThan(0);

      const notice = (await page.getByTestId('sop-draft-not-executable').textContent()) ?? '';
      expect(notice).toContain('not executable');
      expect(notice).toContain('cannot start browser automation');

      const body = (await page.locator('body').textContent()) ?? '';
      expect(body).not.toContain('"schemaVersion"');
      expect(body).not.toContain('storageKey');

      await page.close();
    });

    it('shows why a draft was rejected, and saves nothing', async () => {
      const page = await open();

      // The marker the deterministic provider answers with an invalid graph on
      // both attempts, so the repair loop is exhausted.
      await submit(page, 'INVALID_DRAFT — a description the model cannot turn into a valid graph.');

      const failure = page.getByTestId('sop-draft-failure');
      await expect.poll(() => failure.count(), { timeout: 30_000 }).toBe(1);

      expect(await page.getByTestId('sop-draft-failure-title').textContent()).toContain('rejected');
      expect((await failure.textContent()) ?? '').toContain('Nothing was saved.');

      const issues = (await page.getByTestId('sop-draft-issues').textContent()) ?? '';
      expect(issues).toContain('UNKNOWN_ENTRY_STEP');

      // No draft is shown alongside the failure.
      expect(await page.getByTestId('sop-draft').count()).toBe(0);

      await page.close();
    });

    it('distinguishes a provider failure from a rejected draft', async () => {
      const page = await open();

      await submit(page, 'PROVIDER_FAILURE — simulate the model being unreachable.');

      const failure = page.getByTestId('sop-draft-failure');
      await expect.poll(() => failure.count(), { timeout: 30_000 }).toBe(1);

      const text = (await failure.textContent()) ?? '';
      expect(text).toContain('could not be generated');
      expect(text).not.toContain('rejected');

      await page.close();
    });

    it('exposes no editor, no reorder control, and no approval', async () => {
      const page = await open();

      await submit(page, 'Sign in to the portal, find the request, and review the escalation.');
      await expect.poll(() => page.getByTestId('sop-draft').count(), { timeout: 30_000 }).toBe(1);

      // Sub-phase 2.3, and shipping half of one now would set an expectation
      // this phase cannot meet.
      for (const testId of [
        'sop-step-editor',
        'sop-step-move-up',
        'sop-step-move-down',
        'sop-json-editor',
        'sop-approve-button',
        'sop-reject-button',
      ]) {
        expect(await page.getByTestId(testId).count()).toBe(0);
      }

      await page.close();
    });
  });

  /**
   * Sub-phase 2.3, through the whole stack.
   *
   * One continuous review: generate a draft, read it, correct a step, try a
   * move that is not allowed, answer what the model asked, and approve. Every
   * write creates a new revision, so the page reloads between steps and the
   * assertions are against what the server actually stored.
   */
  describe('reviewing and approving a draft', () => {
    async function openReview(page: Page) {
      await page
        .getByTestId('sop-source-text')
        .fill('Sign in to the portal and review escalations.');
      await page.getByTestId('generate-draft-button').click();
      await expect.poll(() => page.getByTestId('sop-draft').count(), { timeout: 30_000 }).toBe(1);

      await page.getByTestId('open-draft-review').click();
      await expect.poll(() => page.getByTestId('sop-review').count(), { timeout: 30_000 }).toBe(1);
    }

    it('renders the workflow in plain language with no raw JSON', async () => {
      const page = await open();
      await openReview(page);

      const summaries = await page.getByTestId('sop-review-step-summary').allTextContents();
      expect(summaries.length).toBeGreaterThan(5);
      expect(summaries).toContain('Open the service request portal sign-in page');

      const notice = (await page.getByTestId('sop-review-not-executable').textContent()) ?? '';
      expect(notice).toContain('cannot start browser automation');

      const body = (await page.locator('body').textContent()) ?? '';
      expect(body).not.toContain('"schemaVersion"');
      expect(body).not.toContain('graphSha256');

      await page.close();
    });

    it('cannot move the first step up, because that move has no explanation to give', async () => {
      const page = await open();
      await openReview(page);

      // validateReorder throws rather than explaining an out-of-range move, so
      // the control is not offered at all.
      const first = page.getByTestId('sop-step-move-up-open_portal');
      expect(await first.isDisabled()).toBe(true);

      await page.close();
    });

    it('refuses a dependency-breaking move with one sentence, and saves nothing', async () => {
      const page = await open();
      await openReview(page);

      const before = (await page.getByTestId('sop-review-state').textContent()) ?? '';

      // One move, chosen because it is deterministic: "Is the request closed?"
      // reads Status, which the extract step immediately above it produces.
      await page.getByTestId('sop-step-move-up-check_closed').click();

      const failure = page.getByTestId('sop-review-failure');
      await expect.poll(() => failure.count(), { timeout: 15_000 }).toBe(1);

      const message = (await page.getByTestId('sop-review-failure-message').textContent()) ?? '';
      expect(message).toBe(
        'Cannot move "Is the request closed?" before "Extract request details" because the moved ' +
          'step uses Status, which is produced later in the workflow.',
      );

      // The refused move left the revision exactly where it was.
      expect((await page.getByTestId('sop-review-state').textContent()) ?? '').toBe(before);

      await page.close();
    });

    it('explains a move that escapes the decision guarding a step', async () => {
      const page = await open();
      await openReview(page);

      // The other explanation class: reachability cannot see this one, because
      // after the move the step is still reachable — just from places the
      // decision never ran.
      await page.getByTestId('sop-step-move-up-open_advanced_search').click();

      await expect
        .poll(() => page.getByTestId('sop-review-failure').count(), { timeout: 15_000 })
        .toBe(1);

      const message = (await page.getByTestId('sop-review-failure-message').textContent()) ?? '';
      expect(message).toContain('is only reachable on one branch of that decision');
      expect(message).toContain('paths where that decision has not been made');

      await page.close();
    });

    it('saves a step edit as a new revision', async () => {
      const page = await open();
      await openReview(page);

      expect((await page.getByTestId('sop-review-state').textContent()) ?? '').toContain(
        'Revision 1',
      );

      await page.getByTestId('sop-step-edit-open_portal').click();
      await page.getByTestId('field-purpose').fill('Open the corrected portal sign-in page');
      await page.getByTestId('sop-edit-note').fill('The purpose was wrong.');
      await page.getByTestId('sop-step-save').click();

      await expect
        .poll(async () => (await page.getByTestId('sop-review-state').textContent()) ?? '', {
          timeout: 20_000,
        })
        .toContain('Revision 2');

      const summaries = await page.getByTestId('sop-review-step-summary').allTextContents();
      expect(summaries).toContain('Open the corrected portal sign-in page');

      await page.close();
    });

    it('will not submit for review until every question is answered, then approves', async () => {
      const page = await open();
      await openReview(page);

      // Blocked, and the page says why rather than just omitting a button.
      expect(await page.getByTestId('sop-action-submit_for_review').count()).toBe(0);
      const blocked = (await page.getByTestId('sop-submit-blocked').textContent()) ?? '';
      expect(blocked).toContain('clarification question');

      const questions = await page.getByTestId('sop-clarification').count();
      expect(questions).toBeGreaterThan(0);

      for (let index = 0; index < questions; index += 1) {
        const input = page.getByTestId(/^sop-answer-input-/).first();
        if ((await input.count()) === 0) {
          break;
        }
        await input.fill('Confirmed with the service desk lead.');
        await page
          .getByTestId(/^sop-answer-save-/)
          .first()
          .click();
        await page.waitForTimeout(400);
      }

      await expect
        .poll(() => page.getByTestId('sop-action-submit_for_review').count(), { timeout: 20_000 })
        .toBe(1);

      await page.getByTestId('sop-action-submit_for_review').click();
      await expect
        .poll(async () => (await page.getByTestId('sop-review-state').textContent()) ?? '', {
          timeout: 20_000,
        })
        .toContain('In review');

      // Editing is closed while a revision is under review.
      expect(await page.getByTestId('sop-step-edit-open_portal').count()).toBe(0);

      await page.getByTestId('sop-action-approve').click();
      await expect
        .poll(async () => (await page.getByTestId('sop-review-state').textContent()) ?? '', {
          timeout: 20_000,
        })
        .toContain('Approved');

      // Approval is the end of this phase: nothing here publishes or runs.
      expect(await page.getByTestId('sop-action-approve').count()).toBe(0);

      await page.close();
    });
  });

  describe('artifact integrity', () => {
    it('serves bytes that match the digest recorded for the run', async () => {
      const { runId, detail } = await succeededRun();

      expect(detail.artifacts.length).toBeGreaterThan(0);

      for (const artifact of detail.artifacts) {
        const response = await fetch(`${E2E_API_URL}/v1/runs/${runId}/artifacts/${artifact.id}`);
        expect(response.status).toBe(200);

        const bytes = new Uint8Array(await response.arrayBuffer());
        const digest = createHash('sha256').update(bytes).digest('hex');

        // The bytes actually served match both the digest the database recorded
        // and the one the response advertises. The server-side verification that
        // *refuses* altered bytes is asserted in apps/api/src/api.db.test.ts,
        // which can tamper with the stored file; this proves the retained
        // retrieval path is the verified one.
        expect(digest).toBe(artifact.sha256);
        expect(response.headers.get('x-orbit-sha256')).toBe(artifact.sha256);
        expect(bytes.byteLength).toBe(artifact.sizeBytes);
      }
    });
  });
});
