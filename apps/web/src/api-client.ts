import type {
  AgentVersionView,
  CreateRunResultView,
  DataEnvelope,
  RunDetailView,
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
