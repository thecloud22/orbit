import type { RunTrigger } from '@orbit/contracts';
import { describe, expect, it } from 'vitest';

import { executeAgentVersion } from './interpreter';
import { createFakeBrowser, createFakeBrowserFactory, createRecordingStore } from './testing/fakes';
import { loadFixtureAgentIr, SEEDED_AGENT_VERSION_ID } from './testing/fixture';

const TRIGGER: RunTrigger = {
  type: 'watchtower_manual',
  actor: { type: 'development_user', id: 'dev-user' },
  source: { application: 'orbit-browser-worker' },
};

interface RunOptions {
  readonly requestNumber?: string;
  readonly browser?: ReturnType<typeof createFakeBrowser>;
  readonly store?: ReturnType<typeof createRecordingStore>;
}

async function run(options: RunOptions = {}) {
  const browser = options.browser ?? createFakeBrowser();
  const store = options.store ?? createRecordingStore();

  const result = await executeAgentVersion({
    agentVersionId: SEEDED_AGENT_VERSION_ID,
    agentIr: loadFixtureAgentIr(),
    inputs: { requestNumber: options.requestNumber ?? 'SR-1001' },
    trigger: TRIGGER,
    store,
    browser: createFakeBrowserFactory(browser),
  });

  return { result, store, browser };
}

describe('executeAgentVersion — found path', () => {
  it('reaches succeeded/request_found with the extracted outputs', async () => {
    const { result } = await run();

    expect(result.status).toBe('succeeded');
    expect(result.businessOutcome).toBe('request_found');
    expect(result.outputs).toEqual({
      requestNumber: 'SR-1001',
      requestStatus: 'In Progress',
      assignedTeam: 'Infrastructure Operations',
    });
    expect(result.error).toBeNull();
    expect(result.terminalPersistenceFailed).toBe(false);
  });

  it('executes the fixture steps in order and marks each succeeded', async () => {
    const { store } = await run();

    expect(store.steps.map((step) => step.agentStepId)).toEqual([
      'open_request_portal',
      'enter_request_number',
      'submit_request_search',
      'detect_request_result',
      'verify_request_number',
      'extract_request_data',
      'complete_found',
    ]);
    expect(store.steps.every((step) => step.status === 'succeeded')).toBe(true);
  });

  it('emits exactly the contracted event timeline', async () => {
    const { store } = await run();

    expect(store.events.map((event) => event.eventType)).toEqual([
      'run.queued',
      'run.started',

      'step.started',
      'browser.navigation.completed',
      'assertion.passed',
      'artifact.created',
      'artifact.created',
      'step.completed',

      'step.started',
      'browser.fill.completed',
      'artifact.created',
      'step.completed',

      'step.started',
      'browser.click.completed',
      'artifact.created',
      'artifact.created',
      'step.completed',

      'step.started',
      'step.completed',

      'step.started',
      'assertion.passed',
      'step.completed',

      'step.started',
      'browser.extract.completed',
      'step.completed',

      'step.started',
      'artifact.created',
      'artifact.created',
      'step.completed',

      'artifact.created',
      'run.completed',
    ]);
  });

  it('records the trace before the terminal event, and links it to the run', async () => {
    const { store, result } = await run();

    const traceEventIndex = store.events.findIndex(
      (event) => event.payload['kind'] === 'browser_trace',
    );
    const runCompletedIndex = store.events.findIndex(
      (event) => event.eventType === 'run.completed',
    );

    expect(traceEventIndex).toBeGreaterThan(-1);
    expect(traceEventIndex).toBeLessThan(runCompletedIndex);
    expect(result.artifacts.filter((artifact) => artifact.kind === 'browser_trace')).toHaveLength(
      1,
    );
  });

  it('captures a final-state screenshot and DOM snapshot at the terminal step', async () => {
    const { store } = await run();

    const terminalStep = store.steps.at(-1);
    const terminalArtifacts = store.events.filter(
      (event) => event.eventType === 'artifact.created' && event.runStepId === terminalStep?.id,
    );

    expect(terminalArtifacts.map((event) => event.payload['kind'])).toEqual([
      'browser_screenshot',
      'dom_snapshot',
    ]);
    expect(
      terminalArtifacts.every(
        (event) =>
          event.payload['role'] === 'screenshot_after_action' ||
          event.payload['role'] === 'dom_snapshot',
      ),
    ).toBe(true);
  });

  it('never persists the resolved input value in the fill event payload', async () => {
    const { store } = await run();

    const fill = store.events.find((event) => event.eventType === 'browser.fill.completed');

    expect(fill?.payload).toMatchObject({
      locator: 'test_id=request-number-input',
      valueSource: '${inputs.requestNumber}',
      valueLength: 'SR-1001'.length,
    });
    expect(JSON.stringify(fill?.payload)).not.toContain('SR-1001');
  });

  it('closes the browser', async () => {
    const { browser } = await run();
    expect(browser.closed()).toBe(true);
  });
});

describe('executeAgentVersion — not-found path', () => {
  it('branches to complete_not_found and treats it as a business outcome, not a failure', async () => {
    const { result, store } = await run({ requestNumber: 'SR-9999' });

    expect(result.status).toBe('succeeded');
    expect(result.businessOutcome).toBe('request_not_found');
    expect(result.outputs).toEqual({ requestNumber: 'SR-9999' });
    expect(result.error).toBeNull();

    expect(store.steps.map((step) => step.agentStepId)).toEqual([
      'open_request_portal',
      'enter_request_number',
      'submit_request_search',
      'detect_request_result',
      'complete_not_found',
    ]);
  });

  it('records which alternative the expect_one_of step selected', async () => {
    const { store } = await run({ requestNumber: 'SR-9999' });

    const detect = store.steps.find((step) => step.agentStepId === 'detect_request_result');

    expect(detect?.output).toMatchObject({
      selectedAlternativeIndex: 1,
      matchedLocator: 'test_id=request-not-found',
      next: 'complete_not_found',
    });
  });
});

describe('executeAgentVersion — failure behaviour', () => {
  it('classifies a broken locator, fails the step and the run, and executes nothing after it', async () => {
    const browser = createFakeBrowser({ missingTestIds: ['request-status'] });
    const { result, store } = await run({ browser });

    expect(result.status).toBe('failed');
    expect(result.businessOutcome).toBe('none');
    expect(result.outputs).toBeNull();
    expect(result.error?.code).toBe('LOCATOR_NOT_FOUND');

    expect(store.steps.map((step) => step.agentStepId)).toEqual([
      'open_request_portal',
      'enter_request_number',
      'submit_request_search',
      'detect_request_result',
      'verify_request_number',
      'extract_request_data',
    ]);
    expect(store.steps.at(-1)?.status).toBe('failed');
    expect(store.run().status).toBe('failed');
  });

  it('captures best-effort failure evidence with the error_context role', async () => {
    const browser = createFakeBrowser({ missingTestIds: ['request-status'] });
    const { store } = await run({ browser });

    const failedStep = store.steps.at(-1);
    const roles = store.events
      .filter(
        (event) => event.eventType === 'artifact.created' && event.runStepId === failedStep?.id,
      )
      .map((event) => event.payload['role']);

    expect(roles).toEqual(['error_context', 'error_context']);
  });

  it('ends the failed run with run.failed after the trace, and closes the browser', async () => {
    const browser = createFakeBrowser({ missingTestIds: ['request-status'] });
    const { store } = await run({ browser });

    expect(store.events.at(-1)?.eventType).toBe('run.failed');
    expect(store.events.at(-2)?.payload['kind']).toBe('browser_trace');
    expect(browser.closed()).toBe(true);
  });

  it('does not let a failed capture mask the original failure', async () => {
    const browser = createFakeBrowser({
      missingTestIds: ['request-status'],
      failCaptureAfterLocatorFailure: true,
    });
    const { result, store } = await run({ browser });

    expect(result.error?.code).toBe('LOCATOR_NOT_FOUND');
    expect(store.steps.at(-1)?.error?.code).toBe('LOCATOR_NOT_FOUND');
  });

  it('fails a succeeding step whose required evidence cannot be captured', async () => {
    const browser = createFakeBrowser({ failScreenshot: true });
    const { result, store } = await run({ browser });

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('ARTIFACT_STORAGE_ERROR');
    // The browser action itself succeeded; the step still fails.
    expect(store.steps.map((step) => step.agentStepId)).toEqual(['open_request_portal']);
    expect(store.steps[0]?.status).toBe('failed');
  });

  it('keeps the original failure when the trace cannot be persisted', async () => {
    const browser = createFakeBrowser({ missingTestIds: ['request-status'], failTrace: true });
    const { result } = await run({ browser });

    expect(result.error?.code).toBe('LOCATOR_NOT_FOUND');
    expect(result.traceMissing).toBe(true);
  });

  it('reports an ambiguous UI state rather than choosing one', async () => {
    const browser = createFakeBrowser({ showBothResultStates: true });
    const { result } = await run({ browser });

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('UNEXPECTED_UI_STATE');
  });

  it('classifies a navigation failure and fails the first step', async () => {
    const browser = createFakeBrowser({ failNavigation: true });
    const { result, store } = await run({ browser });

    expect(result.error?.code).toBe('NAVIGATION_FAILED');
    expect(store.steps).toHaveLength(1);
    expect(store.steps[0]?.status).toBe('failed');
  });

  it('fails an assertion whose text does not match, and records what it observed', async () => {
    const browser = createFakeBrowser({ text: { 'request-number-result': 'SR-2002' } });
    const { result, store } = await run({ browser });

    expect(result.error?.code).toBe('ASSERTION_FAILED');

    const failed = store.events.find((event) => event.eventType === 'assertion.failed');
    expect(failed?.payload).toMatchObject({ expected: 'SR-1001', observed: 'SR-2002' });
  });

  it('fails the run when required success-path evidence cannot be persisted', async () => {
    const store = createRecordingStore({ failOn: 'recordArtifact' });
    const { result } = await run({ store });

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('ARTIFACT_STORAGE_ERROR');
    expect(store.run().status).toBe('failed');
  });

  it('reports a run left non-terminal when the terminal write itself fails', async () => {
    const store = createRecordingStore({ failOn: 'completeRun' });
    const { result } = await run({ store });

    expect(result.status).toBe('failed');
    expect(result.terminalPersistenceFailed).toBe(false);
    expect(result.error?.code).toBe('INTERNAL_ERROR');
    expect(store.run().status).toBe('failed');
  });

  it('never reports success when neither terminal write can be persisted', async () => {
    const store = createRecordingStore({ failOn: 'failRun' });
    const browser = createFakeBrowser({ missingTestIds: ['request-status'] });
    const { result } = await run({ store, browser });

    expect(result.status).toBe('failed');
    expect(result.terminalPersistenceFailed).toBe(true);
    expect(store.run().status).not.toBe('succeeded');
  });

  it('fails with WORKER_FAILURE when the browser cannot start, leaving a durable run', async () => {
    const store = createRecordingStore();

    const result = await executeAgentVersion({
      agentVersionId: SEEDED_AGENT_VERSION_ID,
      agentIr: loadFixtureAgentIr(),
      inputs: { requestNumber: 'SR-1001' },
      trigger: TRIGGER,
      store,
      browser: {
        open: () => Promise.reject(new Error('chromium is not installed')),
      },
    });

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('WORKER_FAILURE');
    expect(store.run().status).toBe('failed');
    expect(store.events.map((event) => event.eventType)).toEqual(['run.queued', 'run.failed']);
  });
});
