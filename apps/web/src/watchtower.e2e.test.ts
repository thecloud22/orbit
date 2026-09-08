import { createHash } from 'node:crypto';

import {
  E2E_API_URL,
  E2E_BINDABLE_DOCUMENT_ID,
  E2E_BINDABLE_STEP_ID,
  E2E_BOUND_DOCUMENT_ID,
  E2E_BOUND_STEP_ID,
  E2E_WATCHTOWER_URL,
} from '@orbit/api/testing/stack-ports';
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

  /**
   * The seeded agent's own card, on the Agents tab.
   *
   * The Agents tab lists every published agent since sub-phase 2.6, and the
   * end-to-end stack seeds two — the real one and a deliberately broken
   * fixture. Scoping to a card is what keeps these tests about the agent they
   * mean rather than about whichever one happens to sort first.
   */
  const SEEDED_AGENT_CARD = 'agent-card-agentv_find_service_request_0_1_0';

  function seededAgent(page: Page) {
    return page.getByTestId(SEEDED_AGENT_CARD);
  }

  /** Opens Agents, fills the seeded agent's field and starts it. */
  async function startAgentRun(requestNumber: string): Promise<Page> {
    const page = await open('/?view=agents');
    const card = seededAgent(page);
    await card.getByTestId('agent-name').waitFor({ state: 'visible' });
    await card.getByTestId('input-field-requestNumber').fill(requestNumber);
    await card.getByTestId('start-run-button').click();
    return page;
  }

  it('starts SR-1001, reaches a succeeded run, and shows its output', async () => {
    const agents = await open('/?view=agents');

    await expect
      .poll(async () => seededAgent(agents).getByTestId('agent-name').textContent())
      .toContain('Find Service Request');

    await agents.close();

    const page = await startAgentRun('SR-1001');

    // Starting a run leaves the page it was triggered from: what it produced
    // is inspected on a page of its own, not appended beneath the button.
    await page.getByTestId('run-page').waitFor({ state: 'visible', timeout: 30_000 });
    expect(page.url()).toMatch(/runId=run_/);

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
    const page = await startAgentRun('SR-1001');
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
    const page = await startAgentRun('SR-1001');
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
    const page = await startAgentRun('SR-9999');

    const label = await waitForTerminal(page);

    expect(label).toContain('Succeeded');
    expect(label).toContain('request not found');
    expect(await page.getByTestId('run-business-outcome').textContent()).toBe('request_not_found');
    expect(await page.getByTestId('run-error').count()).toBe(0);
    // Named, not judged (ADR-030): a succeeded run is a succeeded run, and
    // Watchtower reports the workflow's own conclusion rather than ranking it.
    expect(await page.getByTestId('run-status-detail').textContent()).toContain(
      'request_not_found',
    );

    await page.close();
  });

  it('rejects an empty request number with a field-level message and starts no run', async () => {
    const page = await open('/?view=agents');
    const card = seededAgent(page);
    await card.getByTestId('agent-name').waitFor({ state: 'visible' });
    await card.getByTestId('input-field-requestNumber').fill('');
    await card.getByTestId('start-run-button').click();

    // A run that fails before it exists has nowhere to navigate to — the
    // error shows right here, on Agents, not on a run page never reached.
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

    it('adds a step at a chosen position, as a new revision', async () => {
      const page = await open();
      await openReview(page);

      const before = await page.getByTestId('sop-review-step-summary').allTextContents();

      // Position 1: after the first step rather than in front of it, so this
      // exercises the ordinary case without also moving the entry step.
      await page.getByTestId('sop-step-insert-1').click();
      await page.getByTestId('sop-insert-kind').selectOption('click');
      await page.getByTestId('field-targetHint').fill('Escalate');
      await page.getByTestId('field-purpose').fill('Escalate the request to the on-call team');
      await page.getByTestId('sop-insert-note').fill('The desk escalates before searching.');
      await page.getByTestId('sop-insert-save').click();

      await expect
        .poll(
          async () => (await page.getByTestId('sop-review-step-summary').allTextContents()).length,
          {
            timeout: 20_000,
          },
        )
        .toBe(before.length + 1);

      const after = await page.getByTestId('sop-review-step-summary').allTextContents();
      expect(after[0]).toBe(before[0]);
      expect(after.join(' ')).toContain('Escalate');

      await page.close();
    });

    it('refuses an insert that would break the workflow, and saves nothing', async () => {
      const page = await open();
      await openReview(page);

      const revision = (await page.getByTestId('sop-review-state').textContent()) ?? '';
      const before = await page.getByTestId('sop-review-step-summary').allTextContents();

      // A click appended after the workflow's terminal step leaves it no longer
      // ending on an outcome — invisible from the step itself, which is exactly
      // why the whole graph is re-validated on the server.
      await page.getByTestId(`sop-step-insert-${String(before.length)}`).click();
      await page.getByTestId('sop-insert-kind').selectOption('click');
      await page.getByTestId('field-targetHint').fill('Something after the end');
      await page.getByTestId('field-purpose').fill('This cannot come last');
      await page.getByTestId('sop-insert-save').click();

      await expect
        .poll(() => page.getByTestId('sop-review-failure').count(), { timeout: 20_000 })
        .toBe(1);
      expect((await page.getByTestId('sop-review-state').textContent()) ?? '').toBe(revision);
      expect(await page.getByTestId('sop-review-step-summary').allTextContents()).toEqual(before);

      await page.close();
    });

    it('names unanswered questions as what blocks publishing, and clears once answered', async () => {
      // Nobody submits for review or approves any more (ADR-028): publishing
      // drives the whole lifecycle. What still belongs in front of a person is
      // a clarification nobody answered, because publishing would refuse on it.
      const page = await open();
      await openReview(page);

      expect(await page.getByTestId('sop-lifecycle-actions').count()).toBe(0);
      expect(await page.getByTestId('sop-action-submit_for_review').count()).toBe(0);
      expect(await page.getByTestId('sop-action-approve').count()).toBe(0);

      const blocked = (await page.getByTestId('sop-publish-blocked').textContent()) ?? '';
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

      // Answered, so nothing stands between this workflow and publishing but
      // its own bindings — and no approval step was ever asked for.
      await expect
        .poll(() => page.getByTestId('sop-publish-blocked').count(), { timeout: 20_000 })
        .toBe(0);

      // The workflow is still a draft that never became executable itself.
      expect(await page.getByTestId('sop-review-not-executable').count()).toBe(1);

      await page.close();
    });
  });

  /**
   * Binding visibility, which 4b's report flagged as the gap this closes:
   * bindings are confirmed in a terminal, so a reviewer here could not see
   * whether a workflow had been mapped at all.
   *
   * The document is seeded with one approved binding and every other step
   * unbound, because there is no way to record one from a web page.
   */
  describe('seeing which steps are mapped to a real page', () => {
    async function openSeededReview(page: Page) {
      await page.goto(`${E2E_WATCHTOWER_URL}/?documentId=${E2E_BOUND_DOCUMENT_ID}`, {
        waitUntil: 'load',
      });
      await expect.poll(() => page.getByTestId('sop-review').count(), { timeout: 30_000 }).toBe(1);
    }

    it('shows an approved binding with the selectors it was recorded with', async () => {
      const page = await open();
      await openSeededReview(page);

      await expect
        .poll(() => page.getByTestId('sop-bindings').count(), { timeout: 20_000 })
        .toBe(1);

      const status = page.getByTestId(`sop-binding-status-${E2E_BOUND_STEP_ID}`);
      expect((await status.textContent()) ?? '').toBe('Approved');

      const selectors =
        (await page.getByTestId('sop-binding-selectors').first().textContent()) ?? '';
      expect(selectors).toContain('test_id=search-request-button');
      expect(selectors).toContain('role_and_name=button "Search"');

      const fingerprint =
        (await page.getByTestId('sop-binding-fingerprint').first().textContent()) ?? '';
      expect(fingerprint).toContain('button');
      expect(fingerprint).toContain('Search');

      await page.close();
    });

    it('shows the unbound steps as not recorded, and unbindable ones as needing nothing', async () => {
      const page = await open();
      await openSeededReview(page);

      await expect
        .poll(() => page.getByTestId('sop-bindings').count(), { timeout: 20_000 })
        .toBe(1);

      const rows = (await page.getByTestId('sop-binding-row').allTextContents()).join('\n');

      expect(rows).toContain('Not recorded');
      // A manual_review step will never have a binding; calling that a gap
      // would report a permanent, correct state as missing work. Neither will a
      // navigate step, which compiles from the workflow's own URL — reporting
      // that one as unrecorded made a ready workflow look unfinished.
      expect(rows).toContain('No binding needed');
      expect(rows).toContain('routes to a person');

      // Counted over the steps the compiler actually requires a binding for.
      const summary = (await page.getByTestId('sop-bindings-summary').textContent()) ?? '';
      expect(summary).toContain('1 of');
      expect(summary).toContain('ready');

      await page.close();
    });

    it('offers no way to approve someone else’s binding, or to bind a person’s step', async () => {
      const page = await open();
      await openSeededReview(page);

      await expect
        .poll(() => page.getByTestId('sop-bindings').count(), { timeout: 20_000 })
        .toBe(1);

      const panel = page.getByTestId('sop-bindings');
      const buttons = (await panel.locator('button').allTextContents()).join('\n');

      // Binding a step is offered (ADR-027); reviewing a binding somebody else
      // made is not, and the panel says as much rather than leaving it to be
      // discovered.
      expect(buttons).not.toContain('Approve');
      expect(buttons).not.toContain('Reject');
      expect((await panel.textContent()) ?? '').toContain(
        'Approving or turning down what someone else recorded is not done from here',
      );

      // The heading and the lead explain the panel without the word "binding",
      // which is the point of ADR-031's rename: three separate people asked what
      // "Mapping to a real page" meant.
      const text = (await panel.textContent()) ?? '';
      expect(text).toContain('What each step does on the page');
      expect((await page.getByTestId('sop-bindings-lead').textContent()) ?? '').not.toContain(
        'binding',
      );

      // A manual_review step routes to a person; there is nothing to bind.
      const manualRow = panel
        .getByTestId('sop-binding-row')
        .filter({ hasText: 'routes to a person' })
        .first();
      expect(await manualRow.locator('button').count()).toBe(0);

      // The terminal path is still named, because it still exists.
      expect((await panel.textContent()) ?? '').toContain('pnpm record:binding');

      await page.close();
    });
  });

  /**
   * Binding a drafted workflow's step from Watchtower — the gap this closes.
   *
   * The browser a person would click in is the one thing substituted, the same
   * way recording substitutes it: the stack's API scripts a capture rather than
   * launching a headed Chromium on a test runner. Everything either side of it
   * — the session, the capture list, the save, the approved binding the review
   * page then reads back — is real.
   */
  describe('binding a drafted step from Watchtower', () => {
    it('opens a session, saves the demonstrated step, and shows it approved', async () => {
      const page = await open();
      await page.goto(`${E2E_WATCHTOWER_URL}/?documentId=${E2E_BINDABLE_DOCUMENT_ID}`, {
        waitUntil: 'load',
      });

      await expect
        .poll(() => page.getByTestId('sop-bindings').count(), { timeout: 30_000 })
        .toBe(1);

      const status = page.getByTestId(`sop-binding-status-${E2E_BINDABLE_STEP_ID}`);
      expect((await status.textContent()) ?? '').toBe('Not recorded');

      await page.getByTestId(`sop-binding-bind-${E2E_BINDABLE_STEP_ID}`).click();

      // The open session is in the URL, so a reload reattaches to the browser
      // rather than orphaning the window it opened.
      await expect
        .poll(() => page.url().includes('bindingSessionId=bind_'), { timeout: 20_000 })
        .toBe(true);

      await expect
        .poll(() => page.getByTestId('binding-session').count(), { timeout: 20_000 })
        .toBe(1);

      // The captures arrive by polling, as they would while someone worked.
      await expect
        .poll(() => page.getByTestId(/^binding-capture-/).count(), { timeout: 20_000 })
        .toBeGreaterThan(0);

      expect(await page.getByTestId('save-binding-button').isDisabled()).toBe(true);
      await page
        .getByTestId(/^binding-capture-/)
        .first()
        .check();

      await page.getByTestId('save-binding-button').click();

      await expect
        .poll(() => page.getByTestId('binding-saved').count(), { timeout: 20_000 })
        .toBe(1);

      await expect
        .poll(async () => (await status.textContent()) ?? '', { timeout: 20_000 })
        .toBe('Approved');

      // Done closes the browser and leaves the review page where it was.
      await page.getByTestId('binding-session-done').click();

      await expect
        .poll(() => page.getByTestId('binding-session').count(), { timeout: 20_000 })
        .toBe(0);
      expect(page.url()).not.toContain('bindingSessionId=');

      await page.close();
    });
  });

  /**
   * Navigation, which Watchtower had none of: every view already had a URL and
   * nothing linked them, so a workflow was unreachable unless you knew its id.
   */
  describe('navigating Watchtower', () => {
    it('shows the nav on every view and marks where you are', async () => {
      const page = await open();

      await expect
        .poll(() => page.getByTestId('watchtower-nav').count(), { timeout: 20_000 })
        .toBe(1);
      expect(await page.getByTestId('nav-home').getAttribute('aria-current')).toBe('page');
      expect(await page.getByTestId('nav-studio').getAttribute('aria-current')).toBeNull();

      await page.getByTestId('nav-studio').click();
      await expect
        .poll(() => page.getByTestId('documents-page').count(), { timeout: 20_000 })
        .toBe(1);
      expect(await page.getByTestId('nav-studio').getAttribute('aria-current')).toBe('page');

      await page.close();
    });

    it('opens Agents and Runs from the nav, each on its own page', async () => {
      const page = await open();

      await page.getByTestId('nav-agents').click();
      await expect
        .poll(() => page.getByTestId(SEEDED_AGENT_CARD).count(), { timeout: 20_000 })
        .toBe(1);
      expect(await page.getByTestId('nav-agents').getAttribute('aria-current')).toBe('page');

      await page.getByTestId('nav-runs').click();
      await expect.poll(() => page.getByTestId('runs-page').count(), { timeout: 20_000 }).toBe(1);
      expect(await page.getByTestId('nav-runs').getAttribute('aria-current')).toBe('page');

      await page.close();
    });

    it('opens a run from the Runs list on its own page', async () => {
      const { runId } = await succeededRun();

      const page = await open('/?view=runs');
      await page.getByTestId(`run-row-${runId}`).waitFor({ state: 'visible', timeout: 20_000 });
      await page.getByTestId(`run-row-${runId}`).click();

      await expect.poll(() => page.getByTestId('run-page').count(), { timeout: 20_000 }).toBe(1);
      expect(page.url()).toContain(`runId=${runId}`);
      expect(await page.getByTestId('nav-runs').getAttribute('aria-current')).toBe('page');

      await page.close();
    });

    it('gives every nav link a real href, so it can be opened in a new tab', async () => {
      const page = await open();

      // Anchors rather than buttons: middle-click and copy-link must keep
      // working, which a button silently breaks.
      expect(await page.getByTestId('nav-studio').getAttribute('href')).toBe('?view=documents');
      expect(await page.getByTestId('nav-home').getAttribute('href')).toBe('/');

      await page.close();
    });

    it('lists documents and opens the right review page when one is clicked', async () => {
      const page = await open('/?view=documents');

      await expect
        .poll(() => page.getByTestId('documents-page').count(), { timeout: 20_000 })
        .toBe(1);

      const row = page.getByTestId(`document-row-${E2E_BOUND_DOCUMENT_ID}`);
      await expect.poll(() => row.count(), { timeout: 20_000 }).toBe(1);

      const detail = (await row.getByTestId('document-detail').textContent()) ?? '';
      expect(detail).toContain('steps');
      expect(detail).toContain('revision');

      await row.click();

      await expect.poll(() => page.getByTestId('sop-review').count(), { timeout: 30_000 }).toBe(1);
      expect(page.url()).toContain(`documentId=${E2E_BOUND_DOCUMENT_ID}`);

      await page.close();
    });

    it('honours the browser back button', async () => {
      // Before this, pushState was called and nothing listened for popstate, so
      // back changed the URL and left the previous view on screen.
      const page = await open('/?view=documents');
      await expect
        .poll(() => page.getByTestId('documents-page').count(), { timeout: 20_000 })
        .toBe(1);

      await page.getByTestId(`document-row-${E2E_BOUND_DOCUMENT_ID}`).click();
      await expect.poll(() => page.getByTestId('sop-review').count(), { timeout: 30_000 }).toBe(1);

      await page.goBack();

      await expect
        .poll(() => page.getByTestId('documents-page').count(), { timeout: 20_000 })
        .toBe(1);
      expect(await page.getByTestId('sop-review').count()).toBe(0);

      await page.goForward();
      await expect.poll(() => page.getByTestId('sop-review').count(), { timeout: 20_000 }).toBe(1);

      await page.close();
    });
  });

  describe('recording a workflow', () => {
    /**
     * The half of recording that is not a person clicking in a browser.
     *
     * The stack's recording sessions are backed by a scripted fake in place of
     * a headed Chromium — a test runner has no display, and a real recording is
     * a human doing the task. Everything either side of the browser is real:
     * the routes, the registry, the translation, the validation, and the
     * document that comes out the far end.
     */
    it('starts from Home, shows what was recorded, and lands on a real document', async () => {
      const page = await open('/');

      await expect
        .poll(() => page.getByTestId('record-workflow-form').count(), { timeout: 20_000 })
        .toBe(1);

      // Nobody should have to discover where the browser opens by waiting for a
      // window that never appears on their own laptop.
      const notice = (await page.getByTestId('recording-local-notice').textContent()) ?? '';
      expect(notice).toContain('machine running Orbit');

      await page.getByTestId('recording-title').fill('Find a service request');
      await page.getByTestId('recording-url').fill('http://localhost:3001/requests');
      await page.getByTestId('start-recording-button').click();

      await expect
        .poll(() => page.getByTestId('recording-session').count(), { timeout: 30_000 })
        .toBe(1);
      expect(page.url()).toContain('recordingSessionId=rec_');

      // The scripted sequence appears through polling, in the order it happened.
      await expect
        .poll(() => page.getByTestId('recording-action').count(), { timeout: 30_000 })
        .toBe(3);

      const rows = await page.getByTestId('recording-action').allTextContents();
      expect(rows[0]).toContain('Opened');
      expect(rows[1]).toContain('Request number');
      expect(rows[2]).toContain('Search');

      await page.getByTestId('finish-recording-button').click();

      // Finishing goes straight to the review page for the document it built.
      await expect.poll(() => page.getByTestId('sop-review').count(), { timeout: 30_000 }).toBe(1);

      const documentId = new URL(page.url()).searchParams.get('documentId');
      expect(documentId).toMatch(/^sopdoc_/);

      // And it is a genuine document in the database, not a client-side view.
      const detail = (await (
        await fetch(`${E2E_API_URL}/v1/sop-documents/${documentId}`)
      ).json()) as {
        data: {
          documentTitle: string;
          steps: readonly unknown[];
          provenance: { kind: string };
          executable: false;
        };
      };

      expect(detail.data.documentTitle).toBe('Find a service request');
      expect(detail.data.steps.length).toBeGreaterThan(0);

      // It went through the real translation, so it is marked as recorded — and
      // it is still a SOP Graph, which never executes anything (ADR-016).
      expect(detail.data.provenance.kind).toBe('recorded');
      expect(detail.data.executable).toBe(false);

      await page.close();
    });

    it('refuses a target that is not a page a browser can open', async () => {
      // The host restriction is gone — a person may record anywhere — but a
      // `file:` URL is not somewhere a browser goes on somebody's behalf, and
      // the refusal happens before any browser is created.
      const response = await fetch(`${E2E_API_URL}/v1/recording-sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Not a page', startUrl: 'file:///etc/passwd' }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { message: string } };
      expect(body.error.message).toContain('protocol');
    });
  });

  describe('publishing', () => {
    it('shows the publication state without ever claiming the document is executable', async () => {
      // The rule ADR-016 fixes and 2.6 must not erode: publishing produces a
      // separate runnable artifact, and the review page keeps saying the
      // workflow itself is not executable. This fixture is authored rather than
      // recorded, and only one of its steps is bound, so it stays short of the
      // bar ADR-027 sets — the one-click path needs *every* bindable step
      // confirmed against a real page, and a partly bound draft gets the
      // missing-work note instead of a button.
      const page = await open(`/?documentId=${E2E_BOUND_DOCUMENT_ID}`);

      await expect.poll(() => page.getByTestId('sop-review').count(), { timeout: 30_000 }).toBe(1);

      await page.getByTestId('sop-publish-panel').waitFor({ state: 'visible', timeout: 30_000 });

      expect(await page.getByTestId('sop-publish-summary').textContent()).toContain(
        'has to be bound to a real page',
      );
      expect(await page.getByTestId('publish-recording-button').count()).toBe(0);

      // And the banner is exactly where it was.
      expect(await page.getByTestId('sop-review-not-executable').count()).toBe(1);

      const detail = (await (
        await fetch(`${E2E_API_URL}/v1/sop-documents/${E2E_BOUND_DOCUMENT_ID}`)
      ).json()) as { data: { executable: false; publication: { agentVersionId: string | null } } };

      expect(detail.data.executable).toBe(false);
      expect(detail.data.publication.agentVersionId).toBeNull();

      await page.close();
    });

    it('refuses to publish a candidate that does not exist', async () => {
      const response = await fetch(
        `${E2E_API_URL}/v1/agent-ir-candidates/aircand_01hzz0000000000000000000/publish`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      );

      expect(response.status).toBe(404);
    });

    it('goes from a fresh recording to a published, listed agent using only the UI', async () => {
      // The gap this closes: compiling and approving a candidate had no
      // Watchtower surface at all. Without this, "Publish" existed on the
      // review page but nothing could ever reach it except a candidate created
      // by hand outside the browser.
      //
      // A recorded workflow now takes exactly one action to become runnable
      // (ADR-025): a person demonstrated every step personally, which stands
      // in for the revision approval, compile, and candidate approval a
      // generated draft still needs done separately. Answering what each
      // outcome means is the one judgement call still asked of a person.
      const page = await open('/');

      await expect
        .poll(() => page.getByTestId('record-workflow-form').count(), { timeout: 20_000 })
        .toBe(1);

      await page.getByTestId('recording-title').fill('Find a service request, end to end');
      await page.getByTestId('recording-url').fill('http://localhost:3001/requests');
      await page.getByTestId('start-recording-button').click();

      await expect
        .poll(() => page.getByTestId('recording-action').count(), { timeout: 30_000 })
        .toBe(3);
      await page.getByTestId('finish-recording-button').click();

      await expect.poll(() => page.getByTestId('sop-review').count(), { timeout: 30_000 }).toBe(1);

      // A recording lands as a draft revision, but the one-click path does not
      // wait for it to be manually submitted and approved first — that
      // transition happens as part of publishing itself. Nor is anyone asked
      // what the single outcome means: a workflow that ends exactly one way has
      // nothing to disambiguate (ADR-028), so publishing really is one click.
      await page
        .getByTestId('publish-recording-button')
        .waitFor({ state: 'visible', timeout: 20_000 });
      // The mapping form is gone entirely: an outcome is the workflow's own
      // declared name, so publishing has no question attached (ADR-030).
      expect(await page.getByTestId('outcome-mapping-completed').count()).toBe(0);
      expect(await page.getByTestId('outcome-mapping-form').count()).toBe(0);
      await page.getByTestId('publish-recording-button').click();

      await expect
        .poll(() => page.getByTestId('open-published-agent').count(), { timeout: 20_000 })
        .toBe(1);

      // The document's own claim about itself never moved, through any of this.
      expect(await page.getByTestId('sop-review-not-executable').count()).toBe(1);

      const documentId = new URL(page.url()).searchParams.get('documentId');
      const detail = (await (
        await fetch(`${E2E_API_URL}/v1/sop-documents/${documentId}`)
      ).json()) as {
        data: { executable: false; publication: { agentVersionId: string | null } };
      };
      expect(detail.data.executable).toBe(false);
      expect(detail.data.publication.agentVersionId).not.toBeNull();

      // And the published agent is reachable the ordinary way, with no
      // candidate-shaped special case in the list the trigger UI reads.
      const versions = (await (await fetch(`${E2E_API_URL}/v1/agent-versions`)).json()) as {
        data: { id: string }[];
      };
      expect(versions.data.map((version) => version.id)).toContain(
        detail.data.publication.agentVersionId,
      );

      // The regression this pins: the agent catalog was fetched once at the
      // page's first load — before this agent existed — and App never
      // remounts as the URL changes, so a fetch keyed to mount alone would
      // never see anything published afterwards. Clicking through to Agents
      // must show the new card without a page reload.
      await page.getByTestId('open-published-agent').click();
      await expect
        .poll(
          () => page.getByTestId(`agent-card-${detail.data.publication.agentVersionId}`).count(),
          { timeout: 20_000 },
        )
        .toBe(1);

      // The other regression this pins: 4f-1 bakes every non-secret typed
      // value into the compiled agent as a literal rather than declaring it as
      // an input, so this agent takes none at all. The trigger form used to be
      // hard-coded to a single field named requestNumber regardless of what an
      // agent actually declared, so starting any agent but the seeded one sent
      // an input it never asked for and the server rightly refused it.
      const card = page.getByTestId(`agent-card-${detail.data.publication.agentVersionId}`);
      expect(await card.getByTestId('start-run-no-inputs').count()).toBe(1);
      expect(await card.getByTestId('input-field-requestNumber').count()).toBe(0);

      await card.getByTestId('start-run-button').click();

      // Starting a run leaves Agents for the run's own page.
      await page.getByTestId('run-page').waitFor({ state: 'visible', timeout: 30_000 });
      await page.getByTestId('run-status-panel').waitFor({ state: 'visible', timeout: 30_000 });
      expect(await page.getByTestId('run-request-error').count()).toBe(0);

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
