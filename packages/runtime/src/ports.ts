import type { Locator } from '@orbit/agent-ir';
import type {
  ArtifactId,
  ArtifactKind,
  ArtifactLinkRole,
  EventId,
  EventType,
  OrbitError,
  RunId,
  RunInputs,
  RunOutputs,
  RunStepId,
  RunTrigger,
  TerminalBusinessOutcome,
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
 * `strategy` is a closed three-member enum naming an element by its test id,
 * its accessible role and name, or its label — so a raw CSS or XPath selector
 * cannot be expressed here. There is deliberately no `evaluate`, no script
 * injection, no exposed page or browser handle, and no generic "perform this
 * action" method: the set of things Orbit can do to a browser is this list and
 * nothing else, and widening it is an interface change that shows up in review.
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
  /**
   * Describes an element as the accessibility tree sees it.
   *
   * Read-only, and the only capability sub-phase 2.4 added. It exists so the
   * runtime can compare a page against the fingerprint a human approved before
   * a real action; the executor reports, and the runtime decides what the
   * report means.
   */
  describeElement(request: LocatorRequest): Promise<ElementDescription>;
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

/**
 * What an element looks like right now.
 *
 * Mirrors `ElementFingerprint` in @orbit/execution-mapping, which is what it is
 * compared against. `tagName` is absent on purpose: reading it needs `evaluate`,
 * and keeping script injection out of the executor is worth more than the field
 * (ADR-018).
 */
export interface ElementDescription {
  readonly role: string | null;
  readonly accessibleName: string | null;
  readonly text: string | null;
  readonly boundingBox: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  } | null;
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
  /**
   * The workflow's own declared outcome name (ADR-030).
   *
   * `TerminalBusinessOutcome` rather than `Exclude<BusinessOutcome, 'none'>`:
   * an outcome is now an identifier rather than a two-name enum, so that
   * `Exclude` had quietly become a no-op over `string` and stated a rule it no
   * longer enforced. The reservation of `none` is enforced by the schema at the
   * boundary, where it can actually be checked.
   */
  readonly businessOutcome: TerminalBusinessOutcome;
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

/**
 * The judgement seam.
 *
 * Exactly the shape `BrowserExecutor` has, and for exactly the same reason:
 * @orbit/runtime declares the interface and never imports a model provider. The
 * composition root (`apps/browser-worker`) injects an implementation, the way it
 * injects @orbit/executor-playwright, and `decision-judge-boundary.test.ts`
 * proves this package cannot reach one transitively.
 *
 * This matters beyond tidiness. ADR-008 denies the runtime broad capability on
 * purpose. Handing it a model client would mean the process that executes
 * approved steps could also call a model for any reason it liked. A one-method
 * interface that returns *an index into a closed list* cannot be repurposed:
 * there is no free-text channel out of it, no way to ask it for a URL, and no
 * way to ask it a question the Agent IR did not declare.
 */
export interface DecisionJudge {
  judge(request: JudgeRequest): Promise<JudgeResult>;
}

/** One alternative, as the judge is shown it. Never a locator or a step id. */
export interface JudgeAlternative {
  readonly outcome: string;
  readonly description: string;
  /** True for the alternative meaning "the evidence does not settle this". */
  readonly insufficientEvidence: boolean;
}

/**
 * Everything the judge is given, and nothing more.
 *
 * `next` targets, locators and step ids are deliberately absent: the judge
 * never sees where an answer leads, so it cannot be steered by consequence, and
 * it has no vocabulary for naming a destination even if it tried. `sources` is
 * page text the runtime already read through the browser executor's ordinary
 * `readText`, redacted by the implementation before it is sent or stored.
 */
export interface JudgeRequest {
  readonly question: string;
  readonly alternatives: readonly JudgeAlternative[];
  readonly sources: readonly { readonly label: string; readonly text: string }[];
  readonly timeoutMs: number;
  /** Causal context for the spend ledger and the audit trail. */
  readonly context: {
    readonly runId: RunId;
    readonly agentVersionId: AgentVersionId;
    readonly agentId: string;
    readonly agentStepId: string;
  };
}

/**
 * Why a judge produced no usable answer.
 *
 * Distinguishable on purpose. Someone diagnosing a halted run has to be able to
 * tell "the model was not sure" from "the model could not answer" from "we ran
 * out of budget", because those lead to three different fixes.
 */
export type JudgeRefusalReason =
  'provider_failed' | 'timed_out' | 'out_of_set' | 'budget_exhausted';

/**
 * What a judge may return.
 *
 * `alternativeIndex` is an index into a list the runtime already holds. Nothing
 * here becomes a locator, a URL, a selector, an expression or a step id — the
 * step's `next` comes from the step definition. `rationale` is recorded as
 * evidence for a person reading the run afterwards and is **never read by any
 * code path**; a test asserts that directly.
 */
export type JudgeResult =
  | {
      readonly ok: true;
      readonly alternativeIndex: number;
      /** 0 to 1. Absent means the provider reported none, which fails closed. */
      readonly confidence?: number;
      readonly rationale?: string;
      readonly usage?: JudgeUsage;
    }
  | {
      readonly ok: false;
      readonly reason: JudgeRefusalReason;
      /** Safe, Orbit-authored explanation. Never a raw provider message. */
      readonly message: string;
      readonly usage?: JudgeUsage;
    };

/** What the call cost and who made it, for the audit trail. */
export interface JudgeUsage {
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostMicroUsd: number;
  readonly latencyMs: number;
}
