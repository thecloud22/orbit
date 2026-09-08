import type { AgentIr } from '@orbit/agent-ir';
import type {
  ArtifactKind,
  ArtifactLinkRole,
  BusinessOutcome,
  OrbitError,
  RunInputs,
  RunOutputs,
  RunStatus,
  RunStepStatus,
  RunTrigger,
} from '@orbit/contracts';

/**
 * The wire shapes Watchtower consumes, and the projections that build them.
 *
 * This module is the boundary between what Orbit persists and what it is willing
 * to say out loud. Storage keys are absent by construction, and a view is built
 * field by field in `projections.ts`, so adding a column to a table can never
 * silently publish it.
 *
 * It deliberately imports neither Fastify nor @orbit/db: Watchtower consumes
 * these types through the `@orbit/api/views` subpath, and the UI's type graph
 * must not reach the database layer any more than its runtime code does.
 */

/** Keys that must never appear in an outbound payload, whatever produced them. */
export const REDACTED_PAYLOAD_KEYS = ['storageKey'] as const;

export interface AgentVersionView {
  readonly id: string;
  readonly agentId: string;
  readonly name: string;
  readonly version: string;
  readonly description: string | null;
  readonly lifecycleStatus: string;
  readonly inputSchema: AgentIr['inputs'];
}

/** What archiving or restoring an agent produced (ADR-026). */
export interface AgentArchiveActionView {
  readonly agentId: string;
  readonly archivedAt: string | null;
}

/**
 * What compiling or approving a candidate produced.
 *
 * Deliberately thin: the caller re-fetches the review after either action, the
 * same pattern the publish action already uses, so this exists only to
 * acknowledge that the write happened and name what to look at next.
 */
export interface CandidateActionView {
  readonly candidateId: string;
  readonly state: string;
  readonly sandboxState: string;
  readonly sandboxNote: string | null;
}

/**
 * What publishing produced.
 *
 * Returned to the review page so it can link out to the agent rather than
 * change its own claim about itself: the SOP Graph stays non-executable after
 * publishing (ADR-016), and the runnable artifact is a different thing.
 */
export interface PublishedAgentVersionView {
  readonly agentVersionId: string;
  readonly agentId: string;
  readonly name: string;
  readonly version: string;
  readonly publishedFromCandidateId: string | null;
  readonly publishedAt: string | null;
}

export interface RunSummaryView {
  readonly id: string;
  readonly status: RunStatus;
  readonly businessOutcome: BusinessOutcome;
  readonly agentVersionId: string;
  readonly queuedAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

/** One row in the cross-agent run list, naming the agent a `RunSummaryView` only points at by id. */
export interface RunListItemView extends RunSummaryView {
  readonly agentName: string;
  readonly agentVersion: string;
}

export interface RunStepView {
  readonly id: string;
  readonly agentStepId: string;
  readonly stepType: string;
  readonly sequence: number;
  readonly attempt: number;
  readonly status: RunStepStatus;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly output: Record<string, unknown> | null;
  readonly error: OrbitError | null;
}

export interface RunEventView {
  readonly id: string;
  readonly sequence: number;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly runStepId: string | null;
  readonly agentStepId: string | null;
  readonly payload: Record<string, unknown>;
  readonly artifactRefs: readonly string[];
}

/**
 * Artifact metadata as Watchtower sees it.
 *
 * `storageKey` is absent by construction — the UI addresses evidence by id
 * through `url`, and no caller ever names a location in the artifact store.
 */
export interface ArtifactView {
  readonly id: string;
  readonly kind: ArtifactKind;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly createdAt: string;
  readonly runStepId: string | null;
  readonly roles: readonly ArtifactLinkRole[];
  /** The controlled API route that serves these bytes. */
  readonly url: string;
}

export interface RunDetailView extends RunSummaryView {
  readonly agentVersion: { readonly id: string; readonly name: string; readonly version: string };
  readonly trigger: RunTrigger;
  readonly inputs: RunInputs;
  readonly outputs: RunOutputs | null;
  readonly error: OrbitError | null;
  readonly steps: readonly RunStepView[];
  readonly events: readonly RunEventView[];
  readonly artifacts: readonly ArtifactView[];
}

export interface CreateRunResultView {
  readonly runId: string;
  readonly status: RunStatus;
  readonly businessOutcome: BusinessOutcome;
  readonly agentVersionId: string;
  readonly createdAt: string;
}

export interface DataEnvelope<T> {
  readonly data: T;
}

/**
 * Removes keys that describe where bytes live.
 *
 * The runtime records `storageKey` in an `artifact.created` payload because the
 * event log is internal evidence. Publishing it would hand a caller the artifact
 * store's internal addressing, which the controlled artifact routes exist
 * specifically to avoid — so it is stripped on the way out rather than never
 * recorded.
 */
export function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  const denied = new Set<string>(REDACTED_PAYLOAD_KEYS);

  for (const [key, value] of Object.entries(payload)) {
    if (!denied.has(key)) {
      redacted[key] = value;
    }
  }

  return redacted;
}

/** The controlled route that serves an artifact's bytes. Never a storage key. */
export function artifactUrl(runId: string, artifactId: string): string {
  return `/v1/runs/${runId}/artifacts/${artifactId}`;
}

/**
 * A generated SOP draft, as Watchtower sees it.
 *
 * Sub-phase 2.2 provides a minimal input surface, not the review UI: this is
 * enough to show what came back, and deliberately not enough to edit it. There
 * is no step editor, no reorder control, and no JSON editor behind these types.
 *
 * Like every other view here it is plain data — no database row, no storage key,
 * no filesystem path, and no provider credential ever reaches it.
 */
export interface SopDraftStepView {
  readonly id: string;
  readonly kind: string;
  /** One line naming the step the way a reviewer sees it. */
  readonly summary: string;
}

export interface SopDraftInputView {
  readonly id: string;
  readonly label: string;
  readonly type: string;
  readonly required: boolean;
}

export interface SopDraftAssumptionView {
  readonly id: string;
  readonly statement: string;
  readonly rationale: string | null;
}

export interface SopDraftQuestionView {
  readonly id: string;
  readonly question: string;
  readonly aboutStepId: string | null;
}

export interface SopDraftRiskView {
  readonly id: string;
  readonly statement: string;
  readonly severity: string;
}

/** Which model produced a draft. Never an API key, never a prompt body. */
export interface SopDraftProvenanceView {
  readonly kind: string;
  readonly provider: string | null;
  readonly model: string | null;
  readonly promptVersion: string | null;
  readonly generatedAt: string | null;
}

export interface SopDraftView {
  readonly documentId: string;
  readonly revisionId: string;
  readonly revisionNumber: number;
  readonly state: string;
  readonly title: string;
  readonly description: string | null;
  readonly steps: readonly SopDraftStepView[];
  readonly inputs: readonly SopDraftInputView[];
  readonly assumptions: readonly SopDraftAssumptionView[];
  readonly clarificationQuestions: readonly SopDraftQuestionView[];
  readonly risks: readonly SopDraftRiskView[];
  readonly provenance: SopDraftProvenanceView;
  /**
   * Always false, and stated rather than implied.
   *
   * The requirements document requires the review surface to say plainly that a
   * draft cannot start browser automation. Sending it as a field means the UI
   * renders a fact from the server rather than a hard-coded reassurance.
   */
  readonly executable: false;
}

/**
 * A revision under review (sub-phase 2.3).
 *
 * Richer than `SopDraftView`, which only had to show what a model had just
 * produced. This one has to support editing, so every step carries its
 * structured fields as well as its plain-language summary — and the summary is
 * produced by `describeStep` on the server, so the UI has no renderer of its own
 * to drift from it.
 */
export interface SopReviewStepView {
  readonly id: string;
  readonly kind: string;
  /** `describeStep`, computed once on the server. */
  readonly summary: string;
  readonly position: number;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  /** Variables this step makes available, in reviewer-facing form. */
  readonly produces: readonly string[];
  /** The step exactly as stored, so the editor round-trips it without loss. */
  readonly step: Record<string, unknown>;
}

export interface SopClarificationView {
  readonly questionId: string;
  readonly question: string;
  readonly aboutStepId: string | null;
  readonly aboutStepSummary: string | null;
  readonly options: readonly string[] | null;
  readonly answer: string | null;
  readonly answeredAt: string | null;
}

export interface SopPublicationView {
  readonly candidateId: string | null;
  readonly candidateState: string | null;
  readonly sandboxState: string | null;
  readonly agentVersionId: string | null;
  readonly agentVersion: string | null;
}

export interface SopDeclaredOutcomeView {
  readonly name: string;
  readonly message: string;
}

export interface SopReviewView {
  readonly documentId: string;
  readonly documentTitle: string;
  readonly revisionId: string;
  readonly revisionNumber: number;
  readonly state: string;
  readonly parentRevisionId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly steps: readonly SopReviewStepView[];
  readonly inputs: readonly SopDraftInputView[];
  readonly assumptions: readonly SopDraftAssumptionView[];
  readonly clarifications: readonly SopClarificationView[];
  readonly unansweredQuestionIds: readonly string[];
  readonly risks: readonly SopDraftRiskView[];
  readonly provenance: SopDraftProvenanceView;
  /** Derived from SOP_REVISION_TRANSITIONS on the server; never a UI list. */
  readonly availableActions: readonly string[];
  /**
   * How far this document has got toward being runnable.
   *
   * Read-only. `executable` below stays `false` whatever this says: publishing
   * produces a separate artifact and changes nothing about the graph (ADR-016).
   */
  readonly publication: SopPublicationView;
  /**
   * The business outcomes this workflow declares.
   *
   * These are what a run of the published agent will record verbatim: an
   * outcome is the workflow's own declared name rather than a translation of
   * it (ADR-030). Nobody is asked to map them onto anything any more, so this
   * is now shown for confirmation — a person can check the list says what they
   * meant before publishing — and used to tell a workflow that has no outcome
   * step yet that there is nothing to publish.
   *
   * Still computed here rather than left to the client to derive from raw step
   * JSON, for the same reason it always was.
   */
  readonly declaredOutcomes: readonly SopDeclaredOutcomeView[];
  readonly editable: boolean;
  readonly reviewNote: string | null;
  readonly reviewedAt: string | null;
  readonly executable: false;
}

export interface SopDocumentSummaryView {
  readonly documentId: string;
  readonly title: string;
  readonly status: string | null;
  readonly revisionCount: number;
  /** Steps in the current revision; 0 when the document has no live revision. */
  readonly stepCount: number;
  readonly createdAt: string;
}

/**
 * Whether a step has an Execution Binding, and what state it is in.
 *
 * A read view, and its route stays read-only by construction: creating a
 * binding is a separate resource (`/v1/binding-sessions`), because it needs a
 * person demonstrating the step against a real page. Two ways to reach that
 * exist and neither is the other's fallback — the recorder CLI (ADR-019) and a
 * binding session driven from Watchtower (ADR-027).
 */
export interface SopBindingSelectorView {
  readonly strategy: string;
  readonly value: string;
  readonly name: string | null;
}

export interface SopBindingFingerprintView {
  readonly role: string | null;
  readonly accessibleName: string | null;
  readonly text: string | null;
  readonly width: number | null;
  readonly height: number | null;
}

export interface SopBindingIssueView {
  readonly code: string;
  readonly message: string;
}

export interface SopStepBindingView {
  readonly stepId: string;
  readonly kind: string;
  /** False for `manual_review`, which routes to a person and takes no binding. */
  readonly bindable: boolean;
  /** `draft`, `needs_review`, `approved`, `rejected` — or null when unbound. */
  readonly status: string | null;
  readonly bindingId: string | null;
  /**
   * How many superseded bindings precede the current one.
   *
   * `superseded` is never a *current* status: a binding is superseded only when
   * its replacement is written in the same transaction, so supersession is
   * history rather than state. A count is how that history stays visible.
   */
  readonly supersededCount: number;
  /**
   * Whether the bound step has changed since the binding was recorded.
   *
   * Orthogonal to `status`, and deliberately so: an *approved* binding can be
   * stale, and showing only the status would let "approved" read as "usable"
   * when the step has since moved underneath it.
   */
  readonly stale: boolean;
  readonly issues: readonly SopBindingIssueView[];
  /** Published for approved bindings only; a draft is still in flux. */
  readonly selectors: readonly SopBindingSelectorView[] | null;
  readonly fingerprint: SopBindingFingerprintView | null;
}

export interface SopBindingsSummaryView {
  readonly bindable: number;
  readonly bound: number;
  readonly approved: number;
  readonly stale: number;
}

export interface SopBindingsView {
  readonly documentId: string;
  readonly revisionId: string;
  readonly steps: readonly SopStepBindingView[];
  readonly summary: SopBindingsSummaryView;
}

/**
 * A recording in progress, as Watchtower shows it.
 *
 * The browser is on the machine running the API, because a person has to see
 * and click it — a real constraint on where Orbit can run, which is why the UI
 * says so rather than leaving it to be discovered.
 */
export interface RecordedActionView {
  readonly order: number;
  readonly kind: string;
  readonly description: string;
  /** A password field was touched and its value deliberately not read. */
  readonly sensitive: boolean;
}

export interface RecordingSessionView {
  readonly sessionId: string;
  readonly title: string;
  readonly startUrl: string;
  readonly currentUrl: string;
  readonly startedAt: string;
  readonly actions: readonly RecordedActionView[];
}

export interface FinishedRecordingView {
  readonly documentId: string;
  readonly stepCount: number;
  readonly bindingCount: number;
}

/**
 * Binding one step of a workflow against a real page, as Watchtower shows it.
 *
 * The same local-browser constraint as recording, for the same reason: the
 * window opens on the machine running the API because a person has to click in
 * it. A binding session differs from a recording session in one visible way —
 * saving a binding does not end it, because binding a workflow means binding
 * several steps and each starts where the last left the page.
 */
export interface BindingCaptureView {
  readonly captureId: string;
  readonly kind: string;
  readonly description: string;
  /** A password field was touched and its value deliberately not read. */
  readonly sensitive: boolean;
}

export interface BindingCaptureFailureView {
  readonly reason: string;
  readonly url: string;
}

export interface BindingTargetStepView {
  readonly stepId: string;
  readonly kind: string;
  readonly summary: string;
  /** `action` — perform the step; `pick` — point at the value to read. */
  readonly mode: string;
  /** What a fill step already declares its value to be. Null otherwise. */
  readonly declaredValue: string | null;
  readonly sensitive: boolean;
  /** An extract step's declared field names. */
  readonly fields: readonly string[];
  /** A decision step's branches, and which have been demonstrated. Empty otherwise. */
  readonly branches: readonly BindingBranchView[];
}

/** One branch of a decision being bound, and whether its element is captured. */
export interface BindingBranchView {
  readonly when: string;
  readonly captured: boolean;
}

export interface BindingSessionView {
  readonly sessionId: string;
  readonly documentId: string;
  readonly startUrl: string;
  readonly currentUrl: string;
  readonly startedAt: string;
  readonly step: BindingTargetStepView;
  readonly captures: readonly BindingCaptureView[];
  readonly failures: readonly BindingCaptureFailureView[];
}

/**
 * What was written when a binding was saved, and where the session stands after.
 *
 * `bindingId` and `state` are null when a decision branch was demonstrated and
 * others are still outstanding: something real happened — the capture is held —
 * but no row was written, and reporting an id for a binding that does not exist
 * would be worse than reporting none.
 */
export interface SavedBindingView {
  readonly bindingId: string | null;
  readonly stepId: string;
  readonly state: string | null;
  readonly session: BindingSessionView;
}

/** Tokens and estimated cost over some set of model calls. */
export interface ModelUsageTotalsView {
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  /** An estimate in millionths of a dollar, never a bill. */
  readonly estimatedCostMicroUsd: number;
}

/** One budget scope: what it allows, what is spent, and what is left. */
export interface ModelBudgetScopeView {
  readonly scope: string;
  /** How the scope reads to a person. */
  readonly label: string;
  /** Null when this scope is uncapped in this deployment. */
  readonly limitTokens: number | null;
  readonly spentTokens: number;
  /** Null when uncapped. Never negative. */
  readonly remainingTokens: number | null;
  readonly exhausted: boolean;
}

/**
 * Model spend, and how much room is left.
 *
 * The per-run scope is deliberately absent: it applies to one Generate request
 * that does not exist until the button is pressed, so there is nothing to
 * report about it beforehand. It is enforced on the server all the same.
 */
export interface ModelUsageView {
  readonly global: ModelUsageTotalsView;
  /** Null when no document was asked about. */
  readonly document: ModelUsageTotalsView | null;
  readonly documentId: string | null;
  readonly scopes: readonly ModelBudgetScopeView[];
  /** True when any scope is out of room, so a Generate would be refused. */
  readonly exhausted: boolean;
  /** Stated on every surface that shows a figure derived from it. */
  readonly costIsEstimated: true;
}

/**
 * One recovery proposal, as Studio shows it (ADR-033).
 *
 * Before and after, side by side, plus the sentence explaining why Orbit
 * believes they are the same element. `deterministic` is published rather than
 * assumed: a reader must be able to tell a proposal no model touched from one a
 * model ranked, without knowing when — or whether — ranking was switched on.
 */
export interface RecoveryProposalView {
  readonly proposalId: string;
  readonly stepId: string;
  readonly state: string;
  /** The binding this would replace. Unchanged while the proposal waits. */
  readonly replacesBindingId: string;
  readonly observedInRunId: string | null;
  readonly summary: string;
  readonly confidence: string;
  readonly deterministic: boolean;
  /** The locator that stopped working, and the one proposed in its place. */
  readonly before: readonly SopBindingSelectorView[];
  readonly after: readonly SopBindingSelectorView[];
  readonly approvedFingerprint: SopBindingFingerprintView | null;
  readonly proposedAt: string;
}

export interface RecoveryProposalsView {
  readonly documentId: string;
  /** Whether this document grants Orbit permission to propose at all. */
  readonly recoveryEnabled: boolean;
  readonly proposals: readonly RecoveryProposalView[];
}
