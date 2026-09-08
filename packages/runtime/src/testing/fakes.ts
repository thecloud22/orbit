import type { Locator } from '@orbit/agent-ir';
import {
  newArtifactId,
  newEventId,
  newRunId,
  newRunStepId,
  type BusinessOutcome,
  type EventId,
  type EventType,
  type OrbitError,
  type RunId,
  type RunOutputs,
  type RunStepId,
} from '@orbit/contracts';

import { RuntimeError } from '../errors';
import type {
  AppendEventInput,
  BrowserExecutor,
  BrowserExecutorFactory,
  CompleteRunInput,
  ElementDescription,
  RecordArtifactInput,
  RecordedArtifact,
  RunRecorder,
  RunStore,
} from '../ports';

/**
 * In-memory doubles for the runtime's two ports.
 *
 * They exist so the interpreter's orchestration — step order, branching, event
 * timeline, evidence policy, failure handling — is testable without a browser or
 * a database. They are not exported from the package: nothing in production may
 * reach them.
 */

export interface FakeBrowserOptions {
  /** Test ids the page will never show, to force a locator failure. */
  readonly missingTestIds?: readonly string[];
  /**
   * Extra locator values the page resolves.
   *
   * A binding's fallback locators name the same element a different way — by
   * role and name, or by label — and the fake resolves by `locator.value`, so a
   * test exercising a fallback has to say that value is on the page.
   */
  readonly alsoVisible?: readonly string[];
  /** Makes both `expect_one_of` states visible at once, to force ambiguity. */
  readonly showBothResultStates?: boolean;
  readonly failNavigation?: boolean;
  readonly failScreenshot?: boolean;
  readonly failDomCapture?: boolean;
  /**
   * Starts failing evidence capture only once a locator failure has occurred,
   * which is the case that matters: a broken page is exactly when best-effort
   * capture is most likely to fail, and it must not replace the failure that
   * broke it.
   */
  readonly failCaptureAfterLocatorFailure?: boolean;
  readonly failTrace?: boolean;
  /** Overrides the text a test id renders. */
  readonly text?: Readonly<Record<string, string>>;
  /**
   * Overrides what `describeElement` reports, so a drift test can make the page
   * disagree with an approved fingerprint.
   */
  readonly describe?: Readonly<Record<string, Partial<ElementDescription>>>;
  /**
   * Reports the overridden description for the first N calls and the true one
   * afterwards — a page that is still settling.
   *
   * Without it the override is permanent, which is real drift. With it, the
   * difference between "the page had not finished loading" and "the page is
   * genuinely different" is what a test can pin down.
   */
  readonly describeSettlesAfterCalls?: number;
}

export interface FakeBrowser extends BrowserExecutor {
  readonly calls: readonly string[];
  readonly closed: () => boolean;
  /** Timeouts `describeElement` was called with, in order. */
  readonly describeTimeouts: readonly number[];
}

const FOUND_REQUEST = 'SR-1001';

/**
 * A double for the demo portal, not for Playwright.
 *
 * It reproduces the portal's three states and its one seeded record, so an
 * interpreter test exercises the same branching a real run does.
 */
export function createFakeBrowser(options: FakeBrowserOptions = {}): FakeBrowser {
  const missing = new Set(options.missingTestIds ?? []);
  const calls: string[] = [];
  let closed = false;
  let sawLocatorFailure = false;
  let describeCalls = 0;
  const describeTimeouts: number[] = [];
  let filled = '';
  let visible = new Set<string>([
    'request-number-input',
    'search-request-button',
    ...(options.alsoVisible ?? []),
  ]);
  let text: Record<string, string> = {};

  function present(locator: Locator): boolean {
    return visible.has(locator.value) && !missing.has(locator.value);
  }

  function captureIsBroken(): boolean {
    return options.failCaptureAfterLocatorFailure === true && sawLocatorFailure;
  }

  function notFound(locator: Locator, action: string): RuntimeError {
    sawLocatorFailure = true;
    return new RuntimeError({
      code: 'LOCATOR_NOT_FOUND',
      message: `${locator.strategy}=${locator.value} did not become actionable for "${action}".`,
      details: [{ field: 'locator', message: `${locator.strategy}=${locator.value}` }],
    });
  }

  return {
    calls,
    closed: () => closed,
    describeTimeouts,

    async navigate(request) {
      calls.push(`navigate:${request.url}`);

      if (options.failNavigation === true) {
        throw new RuntimeError({
          code: 'NAVIGATION_FAILED',
          message: 'The browser could not open the page.',
        });
      }

      visible = new Set([
        'request-number-input',
        'search-request-button',
        ...(options.alsoVisible ?? []),
      ]);
      text = {};
      return { url: request.url, httpStatus: 200 };
    },

    async fill(request) {
      calls.push(`fill:${request.locator.value}`);
      if (!present(request.locator)) {
        throw notFound(request.locator, 'fill');
      }
      filled = request.value;
    },

    async click(request) {
      calls.push(`click:${request.locator.value}`);
      if (!present(request.locator)) {
        throw notFound(request.locator, 'click');
      }

      if (options.showBothResultStates === true) {
        visible.add('request-result');
        visible.add('request-not-found');
        return;
      }

      if (filled === FOUND_REQUEST) {
        visible.add('request-result');
        visible.add('request-number-result');
        visible.add('request-status');
        visible.add('assigned-team');
        text = {
          'request-number-result': FOUND_REQUEST,
          'request-status': 'In Progress',
          'assigned-team': 'Infrastructure Operations',
          ...options.text,
        };
      } else {
        visible.add('request-not-found');
      }
    },

    async waitForVisible(request) {
      calls.push(`waitForVisible:${request.locator.value}`);
      if (!present(request.locator)) {
        throw notFound(request.locator, 'wait for visible');
      }
    },

    async isVisible(request) {
      return present(request.locator);
    },

    async waitForText(request) {
      calls.push(`waitForText:${request.locator.value}`);
      if (!present(request.locator)) {
        return { matched: false, observed: null };
      }

      const observed = text[request.locator.value] ?? '';
      return { matched: observed === request.expected, observed };
    },

    async describeElement(request) {
      calls.push(`describeElement:${request.locator.value}`);
      describeTimeouts.push(request.timeoutMs);

      if (!present(request.locator)) {
        throw notFound(request.locator, 'describe element');
      }

      describeCalls += 1;
      const settlesAfter = options.describeSettlesAfterCalls ?? 0;
      const override = options.describe?.[request.locator.value];

      // The override stands in for whatever the page currently shows. With a
      // settle point it applies only until then — a page mid-render — and
      // without one it never goes away, which is real drift.
      const applyOverride =
        override !== undefined && (settlesAfter === 0 || describeCalls <= settlesAfter);

      const base: ElementDescription = {
        role: 'textbox',
        accessibleName: request.locator.value,
        text: text[request.locator.value] ?? '',
        boundingBox: { x: 0, y: 0, width: 100, height: 20 },
      };

      return applyOverride ? { ...base, ...override } : base;
    },

    async readText(request) {
      calls.push(`readText:${request.locator.value}`);
      if (!present(request.locator)) {
        throw notFound(request.locator, 'read text');
      }
      return text[request.locator.value] ?? '';
    },

    async captureScreenshot() {
      calls.push('captureScreenshot');
      if (options.failScreenshot === true || captureIsBroken()) {
        throw new Error('screenshot unavailable');
      }
      return new TextEncoder().encode('fake-png-bytes');
    },

    async captureDom() {
      calls.push('captureDom');
      if (options.failDomCapture === true || captureIsBroken()) {
        throw new Error('dom unavailable');
      }
      return `<html data-visible="${[...visible].sort().join(',')}"></html>`;
    },

    async finishEvidence() {
      calls.push('finishEvidence');
      if (options.failTrace === true) {
        throw new Error('trace unavailable');
      }
      return [
        {
          kind: 'browser_trace' as const,
          role: 'browser_trace' as const,
          bytes: new TextEncoder().encode('fake-trace-bytes'),
        },
      ];
    },

    async close() {
      calls.push('close');
      closed = true;
    },
  };
}

export function createFakeBrowserFactory(
  browser: FakeBrowser | (() => Promise<FakeBrowser>),
): BrowserExecutorFactory {
  return {
    async open() {
      return typeof browser === 'function' ? browser() : browser;
    },
  };
}

export interface RecordedEvent {
  readonly id: EventId;
  readonly eventType: EventType;
  readonly payload: Record<string, unknown>;
  readonly runStepId: RunStepId | undefined;
  readonly agentStepId: string | undefined;
}

export interface RecordedStep {
  readonly id: RunStepId;
  readonly agentStepId: string;
  readonly stepType: string;
  status: 'running' | 'succeeded' | 'failed';
  output: Record<string, unknown> | undefined;
  error: OrbitError | undefined;
}

export interface RecordingStore extends RunStore {
  readonly events: readonly RecordedEvent[];
  readonly steps: readonly RecordedStep[];
  readonly artifacts: readonly RecordedArtifact[];
  readonly run: () => {
    readonly id: RunId;
    readonly status: 'queued' | 'running' | 'succeeded' | 'failed';
    readonly businessOutcome: BusinessOutcome;
    readonly outputs: RunOutputs | undefined;
    readonly error: OrbitError | undefined;
  };
}

export interface RecordingStoreOptions {
  /** Makes the named recorder call throw, to test persistence failure handling. */
  readonly failOn?: 'completeRun' | 'failRun' | 'recordArtifact';
}

export function createRecordingStore(options: RecordingStoreOptions = {}): RecordingStore {
  const events: RecordedEvent[] = [];
  const steps: RecordedStep[] = [];
  const artifacts: RecordedArtifact[] = [];

  const run = {
    id: newRunId(),
    status: 'queued' as 'queued' | 'running' | 'succeeded' | 'failed',
    businessOutcome: 'none' as BusinessOutcome,
    outputs: undefined as RunOutputs | undefined,
    error: undefined as OrbitError | undefined,
  };

  function append(input: AppendEventInput): EventId {
    const id = newEventId();
    events.push({
      id,
      eventType: input.eventType,
      payload: input.payload,
      runStepId: input.runStepId,
      agentStepId: input.agentStepId,
    });
    return id;
  }

  const recorder: RunRecorder = {
    runId: run.id,

    async markRunning() {
      run.status = 'running';
    },

    async completeRun(input: CompleteRunInput) {
      if (options.failOn === 'completeRun') {
        throw new Error('terminal write rejected');
      }
      run.status = 'succeeded';
      run.businessOutcome = input.businessOutcome;
      run.outputs = input.outputs;
    },

    async failRun(error) {
      if (options.failOn === 'failRun') {
        throw new Error('terminal write rejected');
      }
      run.status = 'failed';
      run.error = error;
    },

    async startStep(input) {
      const id = newRunStepId();
      steps.push({
        id,
        agentStepId: input.agentStepId,
        stepType: input.stepType,
        status: 'running',
        output: undefined,
        error: undefined,
      });
      return id;
    },

    async completeStep(runStepId, output) {
      const step = steps.find((candidate) => candidate.id === runStepId);
      if (step !== undefined) {
        step.status = 'succeeded';
        step.output = output;
      }
    },

    async failStep(runStepId, error) {
      const step = steps.find((candidate) => candidate.id === runStepId);
      if (step !== undefined) {
        step.status = 'failed';
        step.error = error;
      }
    },

    async appendEvent(input) {
      return append(input);
    },

    async recordArtifact(input: RecordArtifactInput): Promise<RecordedArtifact> {
      if (options.failOn === 'recordArtifact') {
        throw new Error('artifact storage rejected');
      }

      const artifactId = newArtifactId();
      const eventId = append({
        eventType: 'artifact.created',
        payload: { artifactId, kind: input.kind, role: input.role },
        ...(input.runStepId === undefined ? {} : { runStepId: input.runStepId }),
        ...(input.agentStepId === undefined ? {} : { agentStepId: input.agentStepId }),
      });

      const recorded: RecordedArtifact = {
        artifactId,
        eventId,
        kind: input.kind,
        role: input.role,
        contentType: 'application/octet-stream',
        storageKey: `runs/${run.id}/${artifactId}`,
        sizeBytes: input.bytes.byteLength,
        sha256: 'f'.repeat(64),
      };

      artifacts.push(recorded);
      return recorded;
    },
  };

  return {
    events,
    steps,
    artifacts,
    run: () => run,
    async createRun() {
      append({ eventType: 'run.queued', payload: {} });
      return recorder;
    },
  };
}
