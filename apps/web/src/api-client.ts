import type {
  AgentArchiveActionView,
  AgentVersionView,
  BindingSessionView,
  CandidateActionView,
  CreateRunResultView,
  DataEnvelope,
  RunDetailView,
  RunListItemView,
  FinishedRecordingView,
  RecordingSessionView,
  SavedBindingView,
  RecoveryProposalsView,
  RecoveryProposalView,
  SopBindingsView,
  PublishedAgentVersionView,
  SopDocumentSummaryView,
  ModelUsageView,
  PlatformView,
  SopDraftView,
  SopReviewView,
  WalkthroughSessionView,
} from '@orbit/api/views';
import type { ErrorDetail, OrbitError } from '@orbit/contracts';

/**
 * The Watchtower API client.
 *
 * Requests are same-origin `/v1/...` paths: the Vite dev server proxies them to
 * the API, so the browser never needs a cross-origin grant and no API host is
 * baked into the bundle.
 *
 * Every non-2xx response is turned into an `ApiRequestError` carrying the
 * server's typed code, so the UI distinguishes a missing artifact from a failed
 * integrity check rather than showing one generic failure.
 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly details: readonly ErrorDetail[];

  constructor(input: {
    readonly status: number;
    readonly message: string;
    readonly code?: string;
    readonly details?: readonly ErrorDetail[];
  }) {
    super(input.message);
    this.name = 'ApiRequestError';
    this.status = input.status;
    this.code = input.code;
    this.details = input.details ?? [];
  }
}

async function toApiError(response: Response): Promise<ApiRequestError> {
  try {
    const body: unknown = await response.json();
    const error = (body as { error?: OrbitError }).error;

    if (error !== undefined) {
      return new ApiRequestError({
        status: response.status,
        message: error.message,
        code: error.code,
        ...(error.details === undefined ? {} : { details: error.details }),
      });
    }
  } catch {
    // A response that is not the error envelope falls through to the generic
    // message below rather than surfacing a parser error to the user.
  }

  return new ApiRequestError({
    status: response.status,
    message: `The request failed with status ${response.status}.`,
  });
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: 'application/json' } });

  if (!response.ok) {
    throw await toApiError(response);
  }

  return ((await response.json()) as DataEnvelope<T>).data;
}

export async function listAgentVersions(): Promise<readonly AgentVersionView[]> {
  return getJson<readonly AgentVersionView[]>('/v1/agent-versions');
}

/** Retires the agent from the active catalog. Every past run is untouched. */
export async function archiveAgent(agentVersionId: string): Promise<AgentArchiveActionView> {
  return send<AgentArchiveActionView>(`/v1/agent-versions/${agentVersionId}/archive`, 'POST', {});
}

/** Reverses `archiveAgent`. */
export async function restoreAgent(agentVersionId: string): Promise<AgentArchiveActionView> {
  return send<AgentArchiveActionView>(`/v1/agent-versions/${agentVersionId}/restore`, 'POST', {});
}

export async function startRun(
  agentVersionId: string,
  inputs: Record<string, string>,
): Promise<CreateRunResultView> {
  const response = await fetch(`/v1/agent-versions/${agentVersionId}/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ inputs }),
  });

  if (!response.ok) {
    throw await toApiError(response);
  }

  return ((await response.json()) as DataEnvelope<CreateRunResultView>).data;
}

export async function getRun(runId: string): Promise<RunDetailView> {
  return getJson<RunDetailView>(`/v1/runs/${runId}`);
}

/** Every run, newest first — the Runs page's starting point. */
export async function listRuns(): Promise<readonly RunListItemView[]> {
  return getJson<readonly RunListItemView[]>('/v1/runs');
}

/**
 * Fetches evidence bytes so the failure can be classified.
 *
 * An `<img src>` would report only "it did not load"; going through fetch means
 * the typed code in the error envelope survives, which is what lets the UI say
 * that evidence failed *integrity verification* rather than that it is missing.
 */
export async function fetchArtifact(url: string): Promise<Blob> {
  const response = await fetch(url);

  if (!response.ok) {
    throw await toApiError(response);
  }

  return response.blob();
}

/**
 * Submits free-form SOP text for generation.
 *
 * A 422 carries the validation issues the generated graph failed on, in the
 * error envelope's `details`, so the caller can show a reviewer why a draft was
 * refused rather than only that it was.
 */
/**
 * Model spend and remaining budget.
 *
 * A courtesy, not a gate. The server refuses a Generate that would exceed a
 * ceiling whether or not anything asked this first; what this buys is telling
 * someone *before* they write three paragraphs.
 */
export async function getModelUsage(documentId?: string): Promise<ModelUsageView> {
  const query = documentId === undefined ? '' : `?documentId=${encodeURIComponent(documentId)}`;
  return getJson(`/v1/model-usage${query}`);
}

/**
 * What this deployment is running with, for the Admin page.
 *
 * A `GET` with no companion writer, which is the endpoint's whole design: every
 * value it reports is deployment configuration resolved when the API process
 * started, so there is nothing here a client could set.
 */
export async function getPlatform(): Promise<PlatformView> {
  return getJson('/v1/platform');
}

export async function createSopDraft(sourceText: string): Promise<SopDraftView> {
  const response = await fetch('/v1/sop-drafts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sourceText }),
  });

  if (!response.ok) {
    throw await toApiError(response);
  }

  return ((await response.json()) as DataEnvelope<SopDraftView>).data;
}

export async function getSopReview(documentId: string): Promise<SopReviewView> {
  return getJson<SopReviewView>(`/v1/sop-documents/${documentId}`);
}

export async function listSopDocuments(): Promise<readonly SopDocumentSummaryView[]> {
  return getJson<readonly SopDocumentSummaryView[]>('/v1/sop-documents');
}

async function send<T>(url: string, method: 'POST' | 'PATCH', body: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw await toApiError(response);
  }

  return ((await response.json()) as DataEnvelope<T>).data;
}

/** Saving an edit never changes the revision being edited; it creates the next one. */
export async function editSopStep(
  revisionId: string,
  stepId: string,
  step: Record<string, unknown>,
  note?: string,
): Promise<{ revisionId: string; revisionNumber: number }> {
  return send(`/v1/sop-revisions/${revisionId}/steps/${stepId}`, 'PATCH', {
    step,
    ...(note === undefined ? {} : { note }),
  });
}

/**
 * Adding a step. Like every other write here, it creates the next revision.
 *
 * No id is sent: one is generated on the server, because branches name their
 * targets by it and the step editor refuses to change one.
 */
export async function insertSopStep(
  revisionId: string,
  index: number,
  step: Record<string, unknown>,
  note?: string,
): Promise<{ revisionId: string; revisionNumber: number; stepId: string }> {
  return send(`/v1/sop-revisions/${revisionId}/steps`, 'POST', {
    index,
    step,
    ...(note === undefined ? {} : { note }),
  });
}

/**
 * Makes a published workflow editable again, as the next revision.
 *
 * The revision that was published is superseded, not reopened, and every
 * binding it had is kept — a binding is keyed by step and step content, never
 * by revision (ADR-036). What is running is untouched until this is published
 * again.
 */
export async function reviseSopDocument(
  documentId: string,
  note?: string,
): Promise<{ revisionId: string; revisionNumber: number; state: string }> {
  return send(`/v1/sop-documents/${documentId}/revisions`, 'POST', {
    ...(note === undefined ? {} : { note }),
  });
}

export async function reorderSopStep(
  revisionId: string,
  stepId: string,
  direction: 'up' | 'down',
): Promise<{ revisionId: string; revisionNumber: number }> {
  return send(`/v1/sop-revisions/${revisionId}/reorder`, 'POST', {
    move: { stepId, direction },
  });
}

export async function answerSopQuestion(
  revisionId: string,
  questionId: string,
  answer: string,
): Promise<{ questionId: string }> {
  return send(`/v1/sop-revisions/${revisionId}/answers`, 'POST', { questionId, answer });
}

export async function transitionSopRevision(
  revisionId: string,
  action: string,
  note?: string,
): Promise<{ revisionId: string; state: string }> {
  return send(`/v1/sop-revisions/${revisionId}/transitions`, 'POST', {
    action,
    ...(note === undefined ? {} : { note }),
  });
}

/**
 * Reads which steps have Execution Bindings.
 *
 * Writing one goes through a binding session below, not through this resource:
 * creating a binding needs a person demonstrating the step against a real page,
 * so it is a session with a browser behind it rather than a field on a form
 * (ADR-019, ADR-027).
 */
export async function getSopBindings(documentId: string): Promise<SopBindingsView> {
  return getJson<SopBindingsView>(`/v1/sop-documents/${documentId}/bindings`);
}

/**
 * Recovery proposals: what Orbit thinks replaced an element that moved.
 *
 * Reading them is safe and idempotent. Accepting one is the only call in this
 * client that turns a proposal into a live mapping, and it goes through the
 * ordinary binding lifecycle on the server (ADR-033).
 */
export async function getRecoveryProposals(documentId: string): Promise<RecoveryProposalsView> {
  return getJson<RecoveryProposalsView>(`/v1/sop-documents/${documentId}/recovery-proposals`);
}

export async function acceptRecoveryProposal(
  documentId: string,
  proposalId: string,
): Promise<{ bindingId: string; stepId: string; state: string }> {
  return send(
    `/v1/sop-documents/${documentId}/recovery-proposals/${proposalId}/accept`,
    'POST',
    {},
  );
}

export async function dismissRecoveryProposal(
  documentId: string,
  proposalId: string,
): Promise<RecoveryProposalView> {
  return send<RecoveryProposalView>(
    `/v1/sop-documents/${documentId}/recovery-proposals/${proposalId}/dismiss`,
    'POST',
    {},
  );
}

/** Opens a browser on the Orbit machine, aimed at one step of one workflow. */
export async function startBindingSession(input: {
  readonly documentId: string;
  readonly stepId: string;
  readonly startUrl: string;
}): Promise<BindingSessionView> {
  return send('/v1/binding-sessions', 'POST', input);
}

export async function getBindingSession(sessionId: string): Promise<BindingSessionView> {
  return getJson<BindingSessionView>(`/v1/binding-sessions/${sessionId}`);
}

/** Points the same open browser at a different step, leaving the page where it is. */
export async function targetBindingStep(
  sessionId: string,
  stepId: string,
): Promise<BindingSessionView> {
  return send(`/v1/binding-sessions/${sessionId}/target`, 'POST', { stepId });
}

/** Saves one demonstrated step as an approved binding. The session stays open. */
export async function saveBinding(
  sessionId: string,
  input: {
    readonly captureId: string;
    readonly valueSource?:
      { kind: 'sop_variable'; name: string } | { kind: 'literal'; value: string };
    readonly readMethod?:
      { kind: 'text' } | { kind: 'attribute'; attribute: string } | { kind: 'checked' };
    readonly variable?: string;
    /** For a decision: which branch this capture demonstrates. */
    readonly branchWhen?: string;
  },
): Promise<SavedBindingView> {
  return send(`/v1/binding-sessions/${sessionId}/binding`, 'POST', input);
}

export async function cancelBindingSession(sessionId: string): Promise<void> {
  const response = await fetch(`/v1/binding-sessions/${sessionId}`, { method: 'DELETE' });

  if (!response.ok) {
    throw await toApiError(response);
  }
}

/**
 * Opens one browser for a whole workflow, to be performed once end to end.
 *
 * The counterpart to `startBindingSession`, and deliberately not a variant of
 * it: this one names no step, because the point is that a person performs the
 * task rather than nine separate demonstrations of its parts (ADR-035).
 */
export async function startWalkthrough(input: {
  readonly documentId: string;
  readonly startUrl: string;
}): Promise<WalkthroughSessionView> {
  return send('/v1/walkthrough-sessions', 'POST', input);
}

export async function getWalkthrough(sessionId: string): Promise<WalkthroughSessionView> {
  return getJson<WalkthroughSessionView>(`/v1/walkthrough-sessions/${sessionId}`);
}

/** Switches between performing the task and pointing at a value to be read. */
export async function setWalkthroughMode(
  sessionId: string,
  mode: 'action' | 'pick',
): Promise<WalkthroughSessionView> {
  return send(`/v1/walkthrough-sessions/${sessionId}/mode`, 'POST', { mode });
}

/**
 * Ends the walkthrough: aligns it, writes the proposals, closes the browser.
 *
 * Writes no binding. What comes back is what a person then reviews, and
 * accepting goes through the ordinary proposal route.
 */
export async function finishWalkthrough(sessionId: string): Promise<WalkthroughSessionView> {
  return send(`/v1/walkthrough-sessions/${sessionId}/proposals`, 'POST', {});
}

export async function cancelWalkthrough(sessionId: string): Promise<void> {
  const response = await fetch(`/v1/walkthrough-sessions/${sessionId}`, { method: 'DELETE' });

  if (!response.ok) {
    throw await toApiError(response);
  }
}

export async function startRecording(
  title: string,
  startUrl: string,
): Promise<RecordingSessionView> {
  return send('/v1/recording-sessions', 'POST', { title, startUrl });
}

export async function getRecordingSession(sessionId: string): Promise<RecordingSessionView> {
  return getJson<RecordingSessionView>(`/v1/recording-sessions/${sessionId}`);
}

export async function finishRecording(sessionId: string): Promise<FinishedRecordingView> {
  return send(`/v1/recording-sessions/${sessionId}/finish`, 'POST', {});
}

export async function cancelRecording(sessionId: string): Promise<void> {
  const response = await fetch(`/v1/recording-sessions/${sessionId}`, { method: 'DELETE' });

  if (!response.ok) {
    throw await toApiError(response);
  }
}

/** Compiles an approved revision and its approved bindings into a candidate agent. */
export async function compileDocument(documentId: string): Promise<CandidateActionView> {
  return send<CandidateActionView>(`/v1/sop-documents/${documentId}/candidates`, 'POST', {});
}

/** The separate technical approval a candidate needs before it can be published. */
export async function approveCandidate(
  candidateId: string,
  note?: string,
): Promise<CandidateActionView> {
  return send<CandidateActionView>(`/v1/agent-ir-candidates/${candidateId}/approve`, 'POST', {
    ...(note === undefined ? {} : { note }),
  });
}

/** Publishes an approved candidate as a runnable Agent Version. */
export async function publishCandidate(candidateId: string): Promise<PublishedAgentVersionView> {
  return send<PublishedAgentVersionView>(
    `/v1/agent-ir-candidates/${candidateId}/publish`,
    'POST',
    {},
  );
}

/**
 * Publishes a workflow whose every step has been bound, in one call.
 *
 * The drafted counterpart to `publishRecording`: a recording confirms a
 * workflow against a real page all at once, binding confirms it one step at a
 * time, and once every step is bound the same one action applies (ADR-027).
 */
export async function publishBoundDocument(documentId: string): Promise<PublishedAgentVersionView> {
  return send<PublishedAgentVersionView>(
    `/v1/sop-documents/${documentId}/publish-bound`,
    'POST',
    {},
  );
}

/**
 * Publishes a recorded workflow in one call: approve, compile, approve,
 * publish, without the separate screens each of those normally takes.
 */
export async function publishRecording(documentId: string): Promise<PublishedAgentVersionView> {
  return send<PublishedAgentVersionView>(
    `/v1/sop-documents/${documentId}/publish-recording`,
    'POST',
    {},
  );
}

/** One operation a registered contract declares, as Studio needs to show it. */
export interface ApiSystemOperationView {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly summary: string | null;
  readonly parameters: readonly {
    readonly name: string;
    readonly location: string;
    readonly required: boolean;
  }[];
}

export interface ApiSystemView {
  readonly id: string;
  readonly catalogId: string;
  readonly name: string;
  readonly authScheme: string;
  readonly credentialRef: string | null;
  /**
   * Whether the deployment supplies the credential — never what it is.
   *
   * `null` when the system needs none. The value itself is not on this type,
   * not on the wire, and not in the database (ADR-038).
   */
  readonly credentialConfigured: boolean | null;
  readonly credentialVariable: string | null;
  readonly hosts: readonly string[];
  readonly operations: readonly ApiSystemOperationView[];
  readonly refusals: readonly { readonly operationId: string; readonly detail: string }[];
  readonly importError: string | null;
}

export async function listApiSystems(): Promise<{ readonly systems: readonly ApiSystemView[] }> {
  return getJson('/v1/api-systems');
}

export async function registerApiSystem(input: {
  readonly catalogId: string;
  readonly name: string;
  readonly spec: string;
  readonly authScheme: 'none' | 'bearer' | 'basic';
  readonly credentialRef?: string;
  readonly authHeaderName?: string;
}): Promise<{ readonly id: string; readonly catalogId: string }> {
  const response = await fetch('/v1/api-systems', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw await toApiError(response);
  }

  return (await response.json()) as { id: string; catalogId: string };
}

export async function deleteApiSystem(id: string): Promise<void> {
  const response = await fetch(`/v1/api-systems/${encodeURIComponent(id)}`, { method: 'DELETE' });

  if (!response.ok) {
    throw await toApiError(response);
  }
}
