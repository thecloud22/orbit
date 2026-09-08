import type { SopDocumentId } from '@orbit/contracts';
import { createRepositories, type ExecutionBindingRecord, type OrbitDatabase } from '@orbit/db';
import type { BindingIssue, ReadMethod, ValueSource } from '@orbit/execution-mapping';
import type { CapturedAction, RecordingSession } from '@orbit/execution-recorder';
import {
  BINDABLE_KINDS,
  bindingBodyFor,
  captureModeForStepKind,
  createBinding,
  defaultValueSourceFor,
  type BindingCapture,
  type BindingChoice,
} from '@orbit/sop-service';
import { describeStep, type SopGraph, type SopStep } from '@orbit/sop-graph';

import type { RecordingSessionFactory } from './session-registry';
import {
  createSessionStore,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_SWEEP_INTERVAL_MS,
} from './session-store';

/**
 * Binding sessions the API is holding open.
 *
 * A drafted workflow reaches the compiler with no Execution Bindings and is
 * refused (`missing_binding`), and until now the only way to create one was a
 * terminal — which put a shell in front of the person the guided path exists
 * for. ADR-027 reverses ADR-019 for this case on the same merits ADR-020 used
 * for whole-workflow recording: a drafted workflow is reviewed in Watchtower,
 * so the browser is the second window, not the third. The recorder CLI remains,
 * and neither path is the other's fallback.
 *
 * Separate from `RecordingSessionRegistry` rather than folded into it. The two
 * differ where it matters: finishing a recording *creates a document and closes
 * the browser*, while saving a binding *writes one row and leaves the browser
 * exactly where it is*, because mapping a workflow means binding several steps
 * in sequence and each starts where the last left the page. One method meaning
 * both things behind one id space is the overload ADR-020 already warned about.
 * What they do share — ids, idle reaping, shutdown — is the shared session
 * store, so a stranded Chromium is impossible in one and not the other.
 *
 * The browser is **headed and local**, exactly as for recording: it opens on
 * the machine running the API, because a person has to see and click it.
 */

export type BindingSessionId = string;

/**
 * The step kinds a binding session will target.
 *
 * Exactly the compiler's `BINDABLE_KINDS`, imported rather than restated so the
 * two cannot drift: a kind the compiler requires a binding for and this set
 * omits is a workflow that can never be published from Watchtower.
 *
 * `navigate` compiles from the graph's own `urlHint`, `manual_review` routes to
 * a person, and `outcome` touches no element, so none of them appears here.
 */
const SESSION_BINDABLE_KINDS: ReadonlySet<string> = BINDABLE_KINDS;

export interface BindingCaptureSummary {
  readonly captureId: string;
  readonly kind: 'click' | 'fill' | 'pick';
  /** Plain language, for someone choosing which capture was the step. */
  readonly description: string;
  /** True when a password field was touched and its value deliberately not read. */
  readonly sensitive: boolean;
}

export interface BindingCaptureFailureSummary {
  readonly reason: string;
  readonly url: string;
}

/** The step being bound, as the person confirming it needs to see it. */
export interface BindingTargetStep {
  readonly stepId: string;
  readonly kind: string;
  /** `describeStep`, so the panel names a step the way the review view does. */
  readonly summary: string;
  /** Whether they perform the step or point at a value to read. */
  readonly mode: 'action' | 'pick';
  /** For a fill: what the step already says its value is. Null otherwise. */
  readonly declaredValue: string | null;
  /** True for a password field, whose value is never captured or stored. */
  readonly sensitive: boolean;
  /** For an extract: the field names the step declares. */
  readonly fields: readonly string[];
  /**
   * For a decision: every branch, and whether it has been demonstrated yet.
   *
   * A decision is bound by walking these in turn — put the screen into that
   * state, point at the element that proves it — so the panel needs to know
   * which one it is asking for and how many are left. Empty for every other
   * kind.
   */
  readonly branches: readonly BindingBranchProgress[];
}

const EMPTY_BRANCH_CAPTURES: ReadonlyMap<string, BindingCapture> = new Map();

/** One branch of a decision, and whether an element has been captured for it. */
export interface BindingBranchProgress {
  readonly when: string;
  readonly captured: boolean;
}

export interface BindingSessionState {
  readonly sessionId: BindingSessionId;
  readonly documentId: string;
  readonly startUrl: string;
  readonly currentUrl: string;
  readonly startedAt: string;
  readonly step: BindingTargetStep;
  readonly captures: readonly BindingCaptureSummary[];
  readonly failures: readonly BindingCaptureFailureSummary[];
}

export interface StartBindingSessionInput {
  readonly documentId: SopDocumentId;
  readonly stepId: string;
  readonly startUrl: string;
}

export type StartBindingSessionResult =
  | { readonly ok: true; readonly state: BindingSessionState }
  | { readonly ok: false; readonly reason: 'document_not_found' }
  | { readonly ok: false; readonly reason: 'unknown_step'; readonly stepId: string }
  | { readonly ok: false; readonly reason: 'not_bindable'; readonly stepId: string }
  | { readonly ok: false; readonly reason: 'session_exists'; readonly sessionId: BindingSessionId };

export type TargetStepResult =
  | { readonly ok: true; readonly state: BindingSessionState }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'browser_closed' }
  | { readonly ok: false; readonly reason: 'document_not_found' }
  | { readonly ok: false; readonly reason: 'unknown_step'; readonly stepId: string }
  | { readonly ok: false; readonly reason: 'not_bindable'; readonly stepId: string };

export interface BindInput {
  readonly captureId: string;
  /** For a fill. Defaults to what the step already declares. */
  readonly valueSource?: ValueSource;
  /** For an extract. Defaults to reading the element's text. */
  readonly readMethod?: ReadMethod;
  /** For an extract: which declared field this populates. */
  readonly variable?: string;
  /**
   * For a decision: which branch this capture demonstrates.
   *
   * Required for a decision and meaningless for anything else. The capture is
   * held against that branch; the binding itself is written only once every
   * branch has one, because a partly bound decision would compile to an
   * `expect_one_of` that cannot name a state the agent can actually reach.
   */
  readonly branchWhen?: string;
}

export type BindResult =
  | {
      readonly ok: true;
      /** Null when a decision branch was recorded and others are still to come. */
      readonly binding: ExecutionBindingRecord | null;
      readonly state: BindingSessionState;
    }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'browser_closed' }
  | { readonly ok: false; readonly reason: 'document_not_found' }
  | { readonly ok: false; readonly reason: 'unknown_step'; readonly stepId: string }
  | { readonly ok: false; readonly reason: 'not_bindable'; readonly stepId: string }
  | { readonly ok: false; readonly reason: 'unknown_capture'; readonly captureId: string }
  | { readonly ok: false; readonly reason: 'refused'; readonly message: string }
  | { readonly ok: false; readonly reason: 'invalid'; readonly issues: readonly BindingIssue[] };

export interface BindingSessionRegistry {
  start(input: StartBindingSessionInput): Promise<StartBindingSessionResult>;
  get(sessionId: BindingSessionId): BindingSessionState | null;
  /** Switches which step is being bound, keeping the page exactly where it is. */
  target(sessionId: BindingSessionId, stepId: string): Promise<TargetStepResult>;
  bind(sessionId: BindingSessionId, input: BindInput): Promise<BindResult>;
  cancel(sessionId: BindingSessionId): Promise<boolean>;
  /** Closes every open browser. Called when the process shuts down. */
  closeAll(): Promise<void>;
}

export interface BindingRegistryOptions {
  readonly database: OrbitDatabase;
  readonly factory: RecordingSessionFactory;
  /** How long an untouched session stays open. Same default as recording. */
  readonly idleTimeoutMs?: number;
  readonly sweepIntervalMs?: number;
  readonly now?: () => Date;
}

interface OpenBindingSession {
  readonly documentId: SopDocumentId;
  readonly startUrl: string;
  readonly startedAt: Date;
  readonly session: RecordingSession;
  /**
   * The step this sitting is currently binding. Changes with `target`.
   *
   * Held so that polling stays synchronous — a poll every second must not read
   * the database — while the *checksum* a binding records is re-read from the
   * current revision at save time, where correctness actually depends on it.
   */
  step: SopStep;
  /**
   * Captures held per decision branch, keyed by the branch's `when` text.
   *
   * Session state rather than persisted state: nothing is written until the set
   * is complete, so abandoning a half-demonstrated decision leaves no partial
   * binding behind. Cleared whenever the session targets a different step.
   */
  branchCaptures: Map<string, BindingCapture>;
}

/** What the page reported, as a sentence someone can read while working. */
function describeCapture(capture: CapturedAction): BindingCaptureSummary {
  const named =
    capture.fingerprint.accessibleName ?? capture.fingerprint.text ?? 'an unnamed element';

  const description =
    capture.type === 'fill'
      ? `Filled "${named}"${capture.sensitive ? ' — password, value not read' : ''}`
      : capture.type === 'click'
        ? `Clicked "${named}"`
        : `Pointed at "${named}"`;

  return {
    captureId: capture.id,
    kind: capture.type,
    description,
    // A typed value is deliberately absent from this summary. It exists to
    // prove the right field was hit, and echoing it back through the API would
    // put whatever someone typed into a place this phase does not protect.
    sensitive: capture.sensitive,
  };
}

function describeTarget(
  step: SopStep,
  branchCaptures: ReadonlyMap<string, BindingCapture>,
): BindingTargetStep {
  return {
    stepId: step.id,
    kind: step.kind,
    summary: describeStep(step),
    mode: captureModeForStepKind(step.kind),
    declaredValue: step.kind === 'fill' ? step.value : null,
    sensitive: step.kind === 'fill' && step.sensitive === true,
    fields: step.kind === 'extract' ? step.fields.map((field) => field.name) : [],
    branches:
      step.kind === 'decision'
        ? step.branches.map((branch) => ({
            when: branch.when,
            captured: branchCaptures.has(branch.when),
          }))
        : [],
  };
}

function findStep(graph: SopGraph, stepId: string): SopStep | undefined {
  return graph.steps.find((step) => step.id === stepId);
}

/** The one judgement a capture cannot supply, defaulted from the step where it can be. */
function choiceFor(
  step: SopStep,
  input: BindInput,
  branchCaptures: ReadonlyMap<string, BindingCapture>,
): BindingChoice | { readonly refusal: string } {
  if (step.kind === 'click') {
    return { kind: 'click' };
  }

  if (step.kind === 'fill') {
    const valueSource = input.valueSource ?? defaultValueSourceFor(step);

    if (valueSource === null || valueSource === undefined) {
      return {
        refusal:
          'This step does not say where its value comes from, so the binding needs one chosen explicitly.',
      };
    }

    return { kind: 'fill', valueSource };
  }

  if (step.kind === 'extract') {
    // A step declaring exactly one field answers this itself; more than one and
    // the choice is the person's, because a binding reads one element.
    const variable =
      input.variable ?? (step.fields.length === 1 ? step.fields[0]?.name : undefined);

    if (variable === undefined) {
      return {
        refusal: 'This step reads more than one value, so the binding must say which one.',
      };
    }

    return { kind: 'extract', readMethod: input.readMethod ?? { kind: 'text' }, variable };
  }

  if (step.kind === 'decision') {
    return {
      kind: 'decision',
      branches: [...branchCaptures].map(([when, capture]) => ({
        when,
        selectors: capture.selectors,
        fingerprint: capture.fingerprint,
      })),
    };
  }

  return {
    refusal: `A "${step.kind}" step is not something a binding session can map to an element.`,
  };
}

export function createBindingSessionRegistry(
  options: BindingRegistryOptions,
): BindingSessionRegistry {
  const now = options.now ?? (() => new Date());
  const repositories = createRepositories(options.database);

  /**
   * Which document has a session open, if any.
   *
   * This registry's rule rather than a property of holding a browser, so it
   * lives beside the store rather than in it.
   */
  const openByDocument = new Map<SopDocumentId, BindingSessionId>();

  const sessions = createSessionStore<OpenBindingSession>({
    idPrefix: 'bind',
    idleTimeoutMs: options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
    sweepIntervalMs: options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS,
    now,
    close: (open) => open.session.close(),
  });

  function toState(sessionId: BindingSessionId, open: OpenBindingSession): BindingSessionState {
    return {
      sessionId,
      documentId: open.documentId,
      startUrl: open.startUrl,
      currentUrl: open.session.currentUrl(),
      startedAt: open.startedAt.toISOString(),
      step: describeTarget(open.step, open.branchCaptures),
      captures: open.session.captures().map(describeCapture),
      failures: open.session
        .failures()
        .map((failure) => ({ reason: failure.reason, url: failure.url })),
    };
  }

  /**
   * The current graph, re-read on every call rather than held.
   *
   * A binding session outlives edits to the workflow it is binding, so the
   * revision and checksum a binding records must be the ones in force when it
   * is saved — not the ones that happened to be current when the browser
   * opened.
   */
  async function currentGraph(documentId: SopDocumentId) {
    return repositories.sopGraphRevisions.findCurrent(documentId);
  }

  return {
    async start(input) {
      await sessions.reapIdle();

      const revision = await currentGraph(input.documentId);

      if (revision === null) {
        return { ok: false, reason: 'document_not_found' };
      }

      const step = findStep(revision.graph, input.stepId);

      if (step === undefined) {
        return { ok: false, reason: 'unknown_step', stepId: input.stepId };
      }

      if (!SESSION_BINDABLE_KINDS.has(step.kind)) {
        return { ok: false, reason: 'not_bindable', stepId: input.stepId };
      }

      // One browser per document. Two open sittings on one workflow would race
      // each other's captures with no way for a person to tell which window
      // they were looking at.
      const existing = openSessionIdFor(input.documentId);

      if (existing !== undefined) {
        return { ok: false, reason: 'session_exists', sessionId: existing };
      }

      const session = await options.factory.open(
        input.startUrl,
        describeTarget(step, EMPTY_BRANCH_CAPTURES).mode,
      );

      const open: OpenBindingSession = {
        documentId: input.documentId,
        startUrl: input.startUrl,
        startedAt: now(),
        session,
        step,
        branchCaptures: new Map(),
      };

      const sessionId = sessions.add(open);
      openByDocument.set(input.documentId, sessionId);

      return { ok: true, state: toState(sessionId, open) };
    },

    get(sessionId) {
      const open = sessions.get(sessionId);
      return open === undefined ? null : toState(sessionId, open);
    },

    async target(sessionId, stepId) {
      const open = sessions.get(sessionId);

      if (open === undefined) {
        return { ok: false, reason: 'not_found' };
      }

      const revision = await currentGraph(open.documentId);

      if (revision === null) {
        return { ok: false, reason: 'document_not_found' };
      }

      const step = findStep(revision.graph, stepId);

      if (step === undefined) {
        return { ok: false, reason: 'unknown_step', stepId };
      }

      if (!SESSION_BINDABLE_KINDS.has(step.kind)) {
        return { ok: false, reason: 'not_bindable', stepId };
      }

      // Nothing stops a person closing the window Orbit opened -- it is their
      // browser. Checked before the page is touched so a closed window is a
      // typed refusal like every other outcome here, rather than a
      // TargetClosedError escaping as a 500.
      //
      // Only re-aiming needs this. `bind` deliberately does not check: a
      // capture is derived when it happens and held in memory, so saving one
      // needs no live page. Guarding it too -- which this first did -- threw
      // away work somebody had already demonstrated, which is worse than the
      // 500 it was meant to fix.
      if (open.session.isClosed()) {
        return { ok: false, reason: 'browser_closed' };
      }

      // Switching modes leaves the page exactly where it is, which is the whole
      // point of not reloading to do it.
      try {
        await open.session.setMode(describeTarget(step, EMPTY_BRANCH_CAPTURES).mode);
      } catch (error) {
        // The check above closes the ordinary case; this closes the race where
        // the window goes away between that check and this call.
        if (open.session.isClosed()) {
          return { ok: false, reason: 'browser_closed' };
        }
        throw error;
      }
      open.session.clearCaptures();
      // Half-demonstrated branches belong to the step that was being bound.
      // Carrying them to the next one would attach an element captured for one
      // decision to a different step's branch of the same name.
      open.branchCaptures.clear();
      open.step = step;

      return { ok: true, state: toState(sessionId, open) };
    },

    async bind(sessionId, input) {
      const open = sessions.get(sessionId);

      if (open === undefined) {
        return { ok: false, reason: 'not_found' };
      }

      const revision = await currentGraph(open.documentId);

      if (revision === null) {
        return { ok: false, reason: 'document_not_found' };
      }

      const step = findStep(revision.graph, open.step.id);

      if (step === undefined) {
        // The step was edited out from under the session. Refused rather than
        // bound to something that no longer exists.
        return { ok: false, reason: 'unknown_step', stepId: open.step.id };
      }

      // Whatever the step reads as now is what gets bound and checksummed.
      open.step = step;

      if (!SESSION_BINDABLE_KINDS.has(step.kind)) {
        return { ok: false, reason: 'not_bindable', stepId: step.id };
      }

      const capture = open.session.captures().find((candidate) => candidate.id === input.captureId);

      if (capture === undefined) {
        return { ok: false, reason: 'unknown_capture', captureId: input.captureId };
      }

      const captured: BindingCapture = {
        selectors: capture.selectors,
        fingerprint: capture.fingerprint,
        url: capture.url,
        ...(capture.typedValue === undefined ? {} : { typedValue: capture.typedValue }),
      };

      // A decision is bound one branch at a time. The capture is held against
      // the branch it demonstrates and nothing is written until every branch
      // has one, so abandoning a half-demonstrated decision leaves no partial
      // binding behind.
      if (step.kind === 'decision') {
        const branch = step.branches.find((candidate) => candidate.when === input.branchWhen);

        if (branch === undefined) {
          return {
            ok: false,
            reason: 'refused',
            message:
              input.branchWhen === undefined
                ? 'This step is a decision, so the capture must say which branch it demonstrates.'
                : `This decision has no branch "${input.branchWhen}".`,
          };
        }

        open.branchCaptures.set(branch.when, captured);
        open.session.clearCaptures();

        const outstanding = step.branches.filter(
          (candidate) => !open.branchCaptures.has(candidate.when),
        );

        if (outstanding.length > 0) {
          return { ok: true, binding: null, state: toState(sessionId, open) };
        }
      }

      const choice = choiceFor(step, input, open.branchCaptures);

      if ('refusal' in choice) {
        return { ok: false, reason: 'refused', message: choice.refusal };
      }

      const body = bindingBodyFor({
        step,
        ...(step.kind === 'decision' ? {} : { capture: captured }),
        choice,
      });

      if (!body.ok) {
        return { ok: false, reason: 'refused', message: body.reason };
      }

      const existing = await repositories.executionBindings.findCurrent(open.documentId, step.id);

      const created = await createBinding({
        database: options.database,
        documentId: open.documentId,
        // The revision and checksum in force *now*, not at session start: if
        // the step was edited mid-session, this binding records what it
        // actually bound against.
        revisionId: revision.id,
        graph: revision.graph,
        step,
        body: body.body,
        ...(existing === null ? {} : { parentBindingId: existing.id }),
        confirmedByDemonstration: {
          reviewNote: 'Approved by demonstrating the step against the page.',
        },
      });

      if (!created.ok) {
        return created.reason === 'not_bindable'
          ? { ok: false, reason: 'not_bindable', stepId: step.id }
          : { ok: false, reason: 'invalid', issues: created.issues };
      }

      // The session deliberately stays open: binding a workflow means binding
      // several steps, and each starts where the last left the page.
      open.session.clearCaptures();
      open.branchCaptures.clear();

      return { ok: true, binding: created.binding, state: toState(sessionId, open) };
    },

    async cancel(sessionId) {
      const open = await sessions.removeAndClose(sessionId);

      if (open === undefined) {
        return false;
      }

      forget(open.documentId, sessionId);
      return true;
    },

    async closeAll() {
      await sessions.closeAll();
      openByDocument.clear();
    },
  };

  /** An entry the store has since reaped is dropped here on the next lookup. */
  function openSessionIdFor(documentId: SopDocumentId): BindingSessionId | undefined {
    const sessionId = openByDocument.get(documentId);

    if (sessionId === undefined) {
      return undefined;
    }

    if (sessions.get(sessionId) === undefined) {
      openByDocument.delete(documentId);
      return undefined;
    }

    return sessionId;
  }

  function forget(documentId: SopDocumentId, sessionId: BindingSessionId): void {
    if (openByDocument.get(documentId) === sessionId) {
      openByDocument.delete(documentId);
    }
  }
}
