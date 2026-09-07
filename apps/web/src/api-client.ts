import type {
  AgentArchiveActionView,
  AgentVersionView,
  CandidateActionView,
  CreateRunResultView,
  DataEnvelope,
  RunDetailView,
  RunListItemView,
  FinishedRecordingView,
  RecordingSessionView,
  SopBindingsView,
  PublishedAgentVersionView,
  SopDocumentSummaryView,
  SopDraftView,
  SopReviewView,
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
 * There is no companion write here, and there will not be one: bindings are
 * created and moved through their lifecycle by the recorder CLI, which requires
 * a human demonstrating a step against a real page (ADR-019).
 */
export async function getSopBindings(documentId: string): Promise<SopBindingsView> {
  return getJson<SopBindingsView>(`/v1/sop-documents/${documentId}/bindings`);
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
export async function compileDocument(
  documentId: string,
  outcomeMapping: Readonly<Record<string, string>>,
): Promise<CandidateActionView> {
  return send<CandidateActionView>(`/v1/sop-documents/${documentId}/candidates`, 'POST', {
    outcomeMapping,
  });
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
 * Publishes a recorded workflow in one call: approve, compile, approve,
 * publish, without the separate screens each of those normally takes.
 */
export async function publishRecording(
  documentId: string,
  outcomeMapping: Readonly<Record<string, string>>,
): Promise<PublishedAgentVersionView> {
  return send<PublishedAgentVersionView>(
    `/v1/sop-documents/${documentId}/publish-recording`,
    'POST',
    { outcomeMapping },
  );
}
