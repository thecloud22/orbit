import type { RunTrigger } from '@orbit/contracts';
import { buttonFingerprint, fieldFingerprint } from '@orbit/execution-mapping/testing';
import { describe, expect, it } from 'vitest';

import type { ExecutionBindingResolver, StepBinding } from './drift';
import { executeAgentVersion } from './interpreter';
import { createFakeBrowser, createFakeBrowserFactory, createRecordingStore } from './testing/fakes';
import { loadFixtureAgentIr, SEEDED_AGENT_VERSION_ID } from './testing/fixture';

/**
 * The drift check, exercised through a whole run rather than in isolation.
 *
 * What matters is not that the comparison function works — that is unit-tested
 * in @orbit/execution-mapping without a browser — but that a mismatch actually
 * stops the run before the action, produces evidence, and never lets the
 * executor substitute a different element.
 */
const TRIGGER: RunTrigger = {
  type: 'watchtower_manual',
  actor: { type: 'development_user', id: 'dev-user' },
  source: { application: 'orbit-browser-worker' },
};

/** The fixture agent's two locator-bearing steps, as the fake page reports them. */
const FILL_STEP = 'enter_request_number';
const CLICK_STEP = 'submit_request_search';

function resolver(bindings: Readonly<Record<string, StepBinding>>): ExecutionBindingResolver {
  return { forStep: (agentStepId) => bindings[agentStepId] ?? null };
}

/** What `createFakeBrowser` reports for an element it has not been told to change. */
function fakePageFingerprint(testId: string) {
  return { role: 'textbox', accessibleName: testId, text: '', boundingBox: null };
}

async function run(options: {
  readonly browser?: ReturnType<typeof createFakeBrowser>;
  readonly bindings?: ExecutionBindingResolver;
}) {
  const browser = options.browser ?? createFakeBrowser();
  const store = createRecordingStore();

  const result = await executeAgentVersion({
    agentVersionId: SEEDED_AGENT_VERSION_ID,
    agentIr: loadFixtureAgentIr(),
    inputs: { requestNumber: 'SR-1001' },
    trigger: TRIGGER,
    store,
    executors: { browser: createFakeBrowserFactory(browser) },
    ...(options.bindings === undefined ? {} : { bindings: options.bindings }),
  });

  return { result, store, browser };
}

describe('the runtime drift check', () => {
  it('changes nothing for an agent with no bindings', async () => {
    // Every Phase 1 agent takes this path, which is why adding a safety gate to
    // the runtime is a change no existing run can observe.
    const { result, browser } = await run({});

    expect(result.status).toBe('succeeded');
    expect(browser.calls.some((call) => call.startsWith('describeElement:'))).toBe(false);
  });

  it('proceeds exactly as before when the page still matches', async () => {
    const { result, browser } = await run({
      bindings: resolver({
        [FILL_STEP]: {
          bindingId: 'execbind_fill',
          fingerprint: fakePageFingerprint('request-number-input'),
          mode: 'action',
        },
      }),
    });

    expect(result.status).toBe('succeeded');
    expect(browser.calls).toContain('describeElement:request-number-input');
    expect(browser.calls).toContain('fill:request-number-input');
  });

  it('stops before the action when the page no longer matches', async () => {
    const browser = createFakeBrowser({
      describe: { 'search-request-button': { role: 'link', accessibleName: 'Advanced search' } },
    });

    const { result } = await run({
      browser,
      bindings: resolver({
        [CLICK_STEP]: {
          bindingId: 'execbind_click',
          fingerprint: buttonFingerprint(),
          mode: 'action',
        },
      }),
    });

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('UNEXPECTED_UI_STATE');
    expect(result.error?.message).toContain('no longer matches');
    expect(result.error?.message).toContain('re-mapping');

    // The action never happened, and no substitute was attempted: refusing to
    // act is the whole point.
    expect(browser.calls).not.toContain('click:search-request-button');
    expect(browser.calls.filter((call) => call.startsWith('click:'))).toEqual([]);
  });

  it('captures evidence when it stops', async () => {
    const browser = createFakeBrowser({
      describe: { 'search-request-button': { role: 'link' } },
    });

    const { store } = await run({
      browser,
      bindings: resolver({
        [CLICK_STEP]: {
          bindingId: 'execbind_click',
          fingerprint: buttonFingerprint(),
          mode: 'action',
        },
      }),
    });

    // Reuses the failure-evidence path every other step failure already uses,
    // which is why a screenshot and a DOM snapshot are there without the drift
    // check capturing anything itself.
    const kinds = store.artifacts.map((artifact) => artifact.kind);
    expect(kinds).toContain('browser_screenshot');
    expect(kinds).toContain('dom_snapshot');
  });

  it('names the field that changed, and what it was when approved', async () => {
    const browser = createFakeBrowser({
      describe: { 'search-request-button': { role: 'link', accessibleName: 'Search' } },
    });

    const { result } = await run({
      browser,
      bindings: resolver({
        [CLICK_STEP]: {
          bindingId: 'execbind_click',
          fingerprint: buttonFingerprint(),
          mode: 'action',
        },
      }),
    });

    const details = result.error?.details ?? [];
    expect(details.map((detail) => detail.field)).toContain('fingerprint.role');
    expect(details.find((detail) => detail.field === 'fingerprint.role')?.message).toContain(
      'approved "button"',
    );
    expect(details.map((detail) => detail.field)).toContain('bindingId');
  });

  it('does not mistake a page that is still loading for a changed one', async () => {
    // The element reports the wrong identity for two polls and the right one
    // afterwards. Treating that as drift would fail runs for being slow.
    const browser = createFakeBrowser({
      describe: { 'request-number-input': { role: 'link', accessibleName: 'not ready' } },
      describeSettlesAfterCalls: 2,
    });

    const { result } = await run({
      browser,
      bindings: resolver({
        [FILL_STEP]: {
          bindingId: 'execbind_fill',
          fingerprint: fakePageFingerprint('request-number-input'),
          mode: 'action',
        },
      }),
    });

    expect(result.status).toBe('succeeded');
    expect(
      browser.calls.filter((call) => call === 'describeElement:request-number-input').length,
    ).toBeGreaterThan(1);
  });

  it('waits for a slow element on the step’s own budget, not the settle window', async () => {
    // The two phases are separate on purpose. Waiting for an element to appear
    // is phase one and gets the whole step budget, so the drift check is never
    // less patient than the action it guards; the short settle window applies
    // only after the element is already on screen. Capping the first wait would
    // fail a page that simply took a while to render, as though it had changed.
    const browser = createFakeBrowser();

    const { result } = await run({
      browser,
      bindings: resolver({
        [FILL_STEP]: {
          bindingId: 'execbind_fill',
          fingerprint: fakePageFingerprint('request-number-input'),
          mode: 'action',
        },
      }),
    });

    expect(result.status).toBe('succeeded');

    // The step's timeout, not DRIFT_SETTLE_WINDOW_MS.
    expect(browser.describeTimeouts[0]).toBe(15_000);
  });

  it('does not compare the text of a read target', async () => {
    // A read target's text is the value being extracted and differs every run.
    const browser = createFakeBrowser();

    const { result } = await run({
      browser,
      bindings: resolver({
        [FILL_STEP]: {
          bindingId: 'execbind_read',
          fingerprint: {
            ...fieldFingerprint(),
            role: 'textbox',
            accessibleName: 'request-number-input',
            text: 'a completely different value',
          },
          mode: 'read',
        },
      }),
    });

    expect(result.status).toBe('succeeded');
  });
});
