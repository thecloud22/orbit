import type { Locator } from '@orbit/agent-ir';
import type {
  ArtifactId,
  ArtifactKind,
  ArtifactLinkRole,
  BusinessOutcome,
  EventId,
  EventType,
  OrbitError,
  RunId,
  RunInputs,
  RunOutputs,
  RunStepId,
  RunTrigger,
  AgentVersionId,
} from '@orbit/contracts';

/**
 * The two seams the runtime is built on.
 *
 * `BrowserExecutor` is the executor interface required by ADR-008: the runtime
 * depends on it, never on Playwright. `RunStore` is the persistence seam, so the
 * interpreter can be exercised in full without a database.
 */

/**
 * A narrow browser capability interface.
 *
 * Every method that touches the page takes the Agent IR `Locator` type, whose
 * `strategy` is a single-member enum, so a raw selector string cannot be
 * expressed here. There is deliberately no `evaluate`, no script injection, no
 * exposed page or browser handle, and no generic "perform this action" method:
 * the set of things Orbit can do to a browser is this list and nothing else, and
 * widening it is an interface change that shows up in review.
 */
export interface BrowserExecutor {
  navigate(request: NavigateRequest): Promise<NavigateResult>;
  fill(request: FillRequest): Promise<void>;
  click(request: ClickRequest): Promise<void>;
  /** Waits for a locator to become visible; used by `locator_visible` assertions. */
  waitForVisible(request: LocatorRequest): Promise<void>;
  /** A single non-waiting probe, used to detect an ambiguous `expect_one_of` match. */
  isVisible(request: { readonly locator: Locator }): Promise<boolean>;
  /** Waits for a locator's trimmed text to equal `expected`, reporting what it observed. */
  waitForText(request: TextRequest): Promise<WaitForTextResult>;
  readText(request: LocatorRequest): Promise<string>;
  captureScreenshot(): Promise<Uint8Array>;
  /** The serialized DOM of the current page. */
  captureDom(): Promise<string>;
  /** Stops tracing and returns the trace bytes. Callable once per executor. */
  finishTrace(): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface NavigateRequest {
  readonly url: string;
  readonly timeoutMs: number;
}

export interface NavigateResult {
  readonly url: string;
  readonly httpStatus: number | null;
}

export interface LocatorRequest {
  readonly locator: Locator;
  readonly timeoutMs: number;
}

export interface FillRequest extends LocatorRequest {
  readonly value: string;
}

export type ClickRequest = LocatorRequest;

export interface TextRequest extends LocatorRequest {
  readonly expected: string;
}

export interface WaitForTextResult {
  readonly matched: boolean;
  /** The last text observed, for the assertion event payload. */
  readonly observed: string | null;
}

/**
 * Opens one isolated browser session per run.
 *
 * The factory rather than a ready executor is what lets the interpreter own the
 * whole lifecycle: the run row exists before the browser is launched, so a
 * launch failure is recorded against a real run instead of vanishing.
 */
export interface BrowserExecutorFactory {
  open(): Promise<BrowserExecutor>;
}

/** Creates the run and returns the recorder bound to it. */
export interface RunStore {
  /** Creates the run as `queued` and appends `run.queued` in one transaction. */
  createRun(input: CreateRunInput): Promise<RunRecorder>;
}

export interface CreateRunInput {
  readonly agentVersionId: AgentVersionId;
  readonly trigger: RunTrigger;
  /** Already validated against the Agent Version's input declarations. */
  readonly inputs: RunInputs;
}

/**
 * Everything the interpreter persists, bound to one run.
 *
 * There is no update or delete of an event, and no way to rewrite a terminal
 * state: the interface mirrors the append-only guarantees the repositories
 * already enforce (ADR-014).
 */
export interface RunRecorder {
  readonly runId: RunId;

  markRunning(): Promise<void>;
  completeRun(input: CompleteRunInput): Promise<void>;
  failRun(error: OrbitError): Promise<void>;

  startStep(input: StartStepInput): Promise<RunStepId>;
  completeStep(runStepId: RunStepId, output?: Record<string, unknown>): Promise<void>;
  failStep(runStepId: RunStepId, error: OrbitError): Promise<void>;

  appendEvent(input: AppendEventInput): Promise<EventId>;

  /**
   * Stores evidence bytes and everything that makes them evidence.
   *
   * The whole ordering — bytes, then metadata, then the entity link, then the
   * `artifact.created` event, then the link that makes the event reference the
   * artifact — lives behind this one method so no call site can get it wrong.
   */
  recordArtifact(input: RecordArtifactInput): Promise<RecordedArtifact>;
}

export interface CompleteRunInput {
  readonly businessOutcome: Exclude<BusinessOutcome, 'none'>;
  readonly outputs: RunOutputs;
}

export interface StartStepInput {
  readonly agentStepId: string;
  readonly stepType: string;
}

export interface AppendEventInput {
  readonly eventType: EventType;
  readonly payload: Record<string, unknown>;
  readonly runStepId?: RunStepId;
  readonly agentStepId?: string;
}

export interface RecordArtifactInput {
  readonly kind: ArtifactKind;
  readonly role: ArtifactLinkRole;
  readonly bytes: Uint8Array;
  /** Absent for run-scoped evidence such as the trace. */
  readonly runStepId?: RunStepId;
  readonly agentStepId?: string;
}

export interface RecordedArtifact {
  readonly artifactId: ArtifactId;
  readonly eventId: EventId;
  readonly kind: ArtifactKind;
  readonly role: ArtifactLinkRole;
  readonly contentType: string;
  readonly storageKey: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}
