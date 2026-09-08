import type { SopDocumentId } from '@orbit/contracts';
import { createRepositories, type OrbitDatabase } from '@orbit/db';
import type { CaptureMode, RecordingSession, SequenceEntry } from '@orbit/execution-recorder';
import type { DemonstratedEntry } from '@orbit/sop-recording';
import {
  describeDemonstrated,
  proposeBindingsFromWalkthrough,
  stepsAwaitingBinding,
  type StepProposal,
} from '@orbit/sop-service';

import type { RecordingSessionFactory } from './session-registry';
import {
  createSessionStore,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_SWEEP_INTERVAL_MS,
} from './session-store';

/**
 * Walkthrough sessions the API is holding open (ADR-035).
 *
 * The third thing in this directory that holds a browser, and the reason it is
 * a third rather than a flag on one of the other two is what *finishing* means.
 * A recording finishes by creating a document. A binding session never
 * finishes — it saves a row and leaves the page exactly where it is, because
 * the next step starts where the last one left off. A walkthrough finishes by
 * writing a set of *proposals* and closing the browser, because the demonstrated
 * task is over and what remains is reading. Three different endings behind one
 * method with a discriminated input is the overload ADR-020 warned about.
 *
 * What all three share — ids, idle reaping, `closeAll`, and the hazard of a
 * Chromium outliving the API — is `session-store.ts`, which is what makes a
 * third registry cheap rather than a third chance to strand a browser.
 *
 * The session deliberately outlives its browser. Once the walkthrough is
 * proposed the window closes but the entry stays, holding the outcome, so a
 * reload of the review screen reattaches to what was proposed and, crucially, to
 * the steps that got *nothing* and why. Those refusals are not in the database:
 * a proposal is a row, and a refusal is the absence of one.
 */

export type WalkthroughSessionId = string;

export interface WalkthroughCaptureSummary {
  readonly order: number;
  readonly kind: 'navigate' | 'click' | 'fill' | 'pick';
  /** Plain language, for someone watching the list grow as they work. */
  readonly description: string;
  readonly sensitive: boolean;
}

/** One drafted step, and what the walkthrough had to say about it. */
export interface WalkthroughStepOutcome {
  readonly stepId: string;
  readonly stepKind: string;
  readonly summary: string;
  readonly proposalId: string | null;
  /** Read live, so a step accepted a moment ago no longer offers accepting. */
  readonly state: string | null;
  readonly demonstrated: string | null;
  readonly refusal: string | null;
  readonly message: string | null;
}

export interface WalkthroughOutcome {
  readonly steps: readonly WalkthroughStepOutcome[];
  readonly proposed: number;
  readonly unusedCaptures: number;
}

export interface WalkthroughSessionState {
  readonly sessionId: WalkthroughSessionId;
  readonly documentId: string;
  readonly startUrl: string;
  readonly currentUrl: string;
  readonly startedAt: string;
  /** Performing the task, or pointing at a value to be read. */
  readonly mode: CaptureMode;
  readonly browserOpen: boolean;
  /** How many steps were waiting for a binding when the walkthrough began. */
  readonly awaitingBinding: number;
  readonly captures: readonly WalkthroughCaptureSummary[];
  readonly failures: readonly { readonly reason: string; readonly url: string }[];
  /** Null until the walkthrough has been turned into proposals. */
  readonly outcome: WalkthroughOutcome | null;
}

export interface StartWalkthroughInput {
  readonly documentId: SopDocumentId;
  readonly startUrl: string;
}

export type StartWalkthroughResult =
  | { readonly ok: true; readonly state: WalkthroughSessionState }
  | { readonly ok: false; readonly reason: 'document_not_found' }
  | { readonly ok: false; readonly reason: 'nothing_to_bind' }
  | {
      readonly ok: false;
      readonly reason: 'session_exists';
      readonly sessionId: WalkthroughSessionId;
    };

export type WalkthroughModeResult =
  | { readonly ok: true; readonly state: WalkthroughSessionState }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'browser_closed' }
  | { readonly ok: false; readonly reason: 'already_proposed' };

export type ProposeWalkthroughResult =
  | { readonly ok: true; readonly state: WalkthroughSessionState }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'document_not_found' }
  | { readonly ok: false; readonly reason: 'nothing_to_bind' }
  | { readonly ok: false; readonly reason: 'nothing_demonstrated' };

export interface WalkthroughSessionRegistry {
  start(input: StartWalkthroughInput): Promise<StartWalkthroughResult>;
  /**
   * Asynchronous, unlike the other two registries' `get`.
   *
   * Once an outcome exists this reads each proposal's current state from the
   * database, so the review screen cannot offer to accept something a second
   * tab already accepted. While the walkthrough is still being performed it
   * touches nothing.
   */
  get(sessionId: WalkthroughSessionId): Promise<WalkthroughSessionState | null>;
  /** Switches between performing the task and pointing at a value to read. */
  setMode(sessionId: WalkthroughSessionId, mode: CaptureMode): Promise<WalkthroughModeResult>;
  /** Aligns what was demonstrated, writes the proposals, and closes the browser. */
  propose(sessionId: WalkthroughSessionId): Promise<ProposeWalkthroughResult>;
  cancel(sessionId: WalkthroughSessionId): Promise<boolean>;
  closeAll(): Promise<void>;
}

export interface WalkthroughRegistryOptions {
  readonly database: OrbitDatabase;
  readonly factory: RecordingSessionFactory;
  readonly idleTimeoutMs?: number;
  readonly sweepIntervalMs?: number;
  readonly now?: () => Date;
}

interface OpenWalkthroughSession {
  readonly documentId: SopDocumentId;
  readonly startUrl: string;
  readonly startedAt: Date;
  readonly session: RecordingSession;
  readonly awaitingBinding: number;
  mode: CaptureMode;
  /**
   * What the walkthrough was aligned to, once it has been.
   *
   * Held here rather than derived on demand because the refusals cannot be
   * derived at all: "nothing in the walkthrough matched this step" is a fact
   * about a sequence that is gone once the browser closes.
   */
  outcome: readonly StepProposal[] | null;
  unusedCaptures: number;
  /** Set when proposing closed the window, so `browserOpen` stays truthful. */
  browserClosed: boolean;
}

/** What the page reported, as a sentence somebody can read while working. */
function describeCapture(entry: SequenceEntry): WalkthroughCaptureSummary {
  if (entry.type === 'navigate') {
    return {
      order: entry.order,
      kind: 'navigate',
      description: `Opened ${entry.url}`,
      sensitive: false,
    };
  }

  return {
    order: entry.order,
    kind: entry.type,
    description: describeDemonstrated(toDemonstrated(entry)),
    // A typed value is deliberately absent here, exactly as it is from a
    // binding session's capture list: it exists to prove the right field was
    // hit, and echoing it through the API would put whatever somebody typed
    // into a place this phase does not protect.
    sensitive: entry.sensitive,
  };
}

/**
 * The recorder's capture, as alignment needs it.
 *
 * The same trick `RecordedEntry` uses: the shape crosses the boundary, not the
 * type, so `@orbit/sop-service` still has no import path to the capture engine.
 */
function toDemonstrated(entry: SequenceEntry): DemonstratedEntry {
  if (entry.type === 'navigate') {
    return { kind: 'navigate', url: entry.url };
  }

  return {
    kind: entry.type,
    selectors: entry.selectors,
    fingerprint: entry.fingerprint,
    ...(entry.typedValue === undefined ? {} : { typedValue: entry.typedValue }),
    sensitive: entry.sensitive,
    url: entry.url,
  };
}

export function createWalkthroughSessionRegistry(
  options: WalkthroughRegistryOptions,
): WalkthroughSessionRegistry {
  const now = options.now ?? (() => new Date());
  const repositories = createRepositories(options.database);

  /** Which document has a walkthrough open, if any. This registry's own rule. */
  const openByDocument = new Map<SopDocumentId, WalkthroughSessionId>();

  const sessions = createSessionStore<OpenWalkthroughSession>({
    idPrefix: 'walk',
    idleTimeoutMs: options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
    sweepIntervalMs: options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS,
    now,
    close: (open) => open.session.close(),
  });

  /** How many steps this document still needs a binding for. */
  async function countAwaiting(documentId: SopDocumentId): Promise<number | null> {
    const revision = await repositories.sopGraphRevisions.findCurrent(documentId);

    if (revision === null) {
      return null;
    }

    const live = await repositories.executionBindings.listCurrent(documentId);

    return stepsAwaitingBinding(revision.graph, new Set(live.map((row) => row.stepId))).length;
  }

  async function toState(
    sessionId: WalkthroughSessionId,
    open: OpenWalkthroughSession,
  ): Promise<WalkthroughSessionState> {
    return {
      sessionId,
      documentId: open.documentId,
      startUrl: open.startUrl,
      currentUrl: open.browserClosed ? open.startUrl : open.session.currentUrl(),
      startedAt: open.startedAt.toISOString(),
      mode: open.mode,
      browserOpen: !open.browserClosed && !open.session.isClosed(),
      awaitingBinding: open.awaitingBinding,
      captures: open.session.sequence().map(describeCapture),
      failures: open.session
        .failures()
        .map((failure) => ({ reason: failure.reason, url: failure.url })),
      outcome: await describeOutcome(open),
    };
  }

  /**
   * The outcome, with each proposal's state re-read.
   *
   * A proposal accepted in another tab, or dismissed, must not still be offered
   * here. The alternative — trusting what was true when the walkthrough
   * finished — would put an accept button in front of somebody for a row that
   * has already been resolved.
   */
  async function describeOutcome(open: OpenWalkthroughSession): Promise<WalkthroughOutcome | null> {
    if (open.outcome === null) {
      return null;
    }

    const steps: WalkthroughStepOutcome[] = [];

    for (const step of open.outcome) {
      if (step.outcome === 'refused') {
        steps.push({
          stepId: step.stepId,
          stepKind: step.stepKind,
          summary: step.summary,
          proposalId: null,
          state: null,
          demonstrated: null,
          refusal: step.refusal,
          message: step.message,
        });
        continue;
      }

      const stored = await repositories.bindingRecoveryProposals.findById(step.proposalId as never);

      steps.push({
        stepId: step.stepId,
        stepKind: step.stepKind,
        summary: step.summary,
        proposalId: step.proposalId,
        // A proposal the database no longer has is reported as gone rather than
        // as still open, which is the safe direction: no accept button.
        state: stored?.state ?? 'gone',
        demonstrated: step.demonstrated,
        refusal: null,
        message: null,
      });
    }

    return {
      steps,
      proposed: steps.filter((step) => step.proposalId !== null).length,
      unusedCaptures: open.unusedCaptures,
    };
  }

  function openSessionIdFor(documentId: SopDocumentId): WalkthroughSessionId | undefined {
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

  return {
    async start(input) {
      await sessions.reapIdle();

      const awaiting = await countAwaiting(input.documentId);

      if (awaiting === null) {
        return { ok: false, reason: 'document_not_found' };
      }

      // Refused rather than opened: a browser that could produce nothing is a
      // window somebody has to close for no reason.
      if (awaiting === 0) {
        return { ok: false, reason: 'nothing_to_bind' };
      }

      const existing = openSessionIdFor(input.documentId);

      if (existing !== undefined) {
        return { ok: false, reason: 'session_exists', sessionId: existing };
      }

      // 'action' throughout the performing half: a walkthrough is a person
      // doing the task, and the page must react exactly as it would for them.
      // Reading a value is the exception, and it is an explicit mode switch.
      const session = await options.factory.open(input.startUrl, 'action');

      const open: OpenWalkthroughSession = {
        documentId: input.documentId,
        startUrl: input.startUrl,
        startedAt: now(),
        session,
        awaitingBinding: awaiting,
        mode: 'action',
        outcome: null,
        unusedCaptures: 0,
        browserClosed: false,
      };

      const sessionId = sessions.add(open);
      openByDocument.set(input.documentId, sessionId);

      return { ok: true, state: await toState(sessionId, open) };
    },

    async get(sessionId) {
      const open = sessions.get(sessionId);
      return open === undefined ? null : toState(sessionId, open);
    },

    async setMode(sessionId, mode) {
      const open = sessions.get(sessionId);

      if (open === undefined) {
        return { ok: false, reason: 'not_found' };
      }

      if (open.outcome !== null) {
        return { ok: false, reason: 'already_proposed' };
      }

      // Their browser, and nothing stops them closing it. Checked before the
      // page is touched so a closed window is a typed refusal rather than a
      // TargetClosedError escaping as a 500.
      if (open.session.isClosed()) {
        return { ok: false, reason: 'browser_closed' };
      }

      try {
        await open.session.setMode(mode);
      } catch (error) {
        // Closes the race where the window goes between the check and the call.
        if (open.session.isClosed()) {
          return { ok: false, reason: 'browser_closed' };
        }
        throw error;
      }

      open.mode = mode;

      return { ok: true, state: await toState(sessionId, open) };
    },

    async propose(sessionId) {
      const open = sessions.get(sessionId);

      if (open === undefined) {
        return { ok: false, reason: 'not_found' };
      }

      // Idempotent: asking twice returns what was proposed the first time
      // rather than aligning a sequence that has since been thrown away.
      if (open.outcome !== null) {
        return { ok: true, state: await toState(sessionId, open) };
      }

      // Read before the browser is touched, so a window closed mid-walkthrough
      // still yields everything demonstrated up to that point. Losing an hour of
      // somebody's demonstration because they closed the window first would be
      // the same mistake `bind` was fixed for.
      const sequence = open.session.sequence().map(toDemonstrated);

      const proposed = await proposeBindingsFromWalkthrough({
        database: options.database,
        documentId: open.documentId,
        sequence,
      });

      if (!proposed.ok) {
        return { ok: false, reason: proposed.reason };
      }

      open.outcome = proposed.result.steps;
      open.unusedCaptures = proposed.result.unusedCaptures;

      // The task is over, so the window goes. This is where a walkthrough
      // differs from a binding sitting, which keeps its page because the next
      // step starts where the last one left it.
      await open.session.close().catch(() => undefined);
      open.browserClosed = true;
      openByDocument.delete(open.documentId);

      return { ok: true, state: await toState(sessionId, open) };
    },

    async cancel(sessionId) {
      const open = await sessions.removeAndClose(sessionId);

      if (open === undefined) {
        return false;
      }

      if (openByDocument.get(open.documentId) === sessionId) {
        openByDocument.delete(open.documentId);
      }

      return true;
    },

    async closeAll() {
      await sessions.closeAll();
      openByDocument.clear();
    },
  };
}
