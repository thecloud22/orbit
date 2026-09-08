import {
  RuntimeError,
  type ApiExecutor,
  type ApiSendRequest,
  type ApiSendResult,
  type SurfaceEvidence,
} from '@orbit/runtime';

/**
 * The API surface's executor.
 *
 * It issues exactly the request it is handed. There is no catalog here, no
 * permission list, no URL construction and no retry policy: the runtime resolves
 * the operation, fills its parameters, checks the host, and passes down
 * something already decided. This package cannot call anything the runtime did
 * not already approve, which is the same division `BrowserExecutor` has -- the
 * executor acts, the runtime decides (ADR-008).
 */
export const PACKAGE_NAME = '@orbit/executor-http' as const;

/** Response bodies beyond this are truncated in evidence, not in the run. */
export const MAX_EVIDENCE_BYTES = 64 * 1024;

/** Header names never written to evidence, whatever their value. */
const SENSITIVE_HEADERS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
];

interface Exchange {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly status: number;
  readonly body: string;
}

export interface HttpExecutorOptions {
  /** Injected so tests drive a stub without a network. Defaults to global fetch. */
  readonly fetch?: typeof globalThis.fetch;
}

export function createHttpExecutorFactory(options: HttpExecutorOptions = {}) {
  return {
    open(): Promise<ApiExecutor> {
      return Promise.resolve(createExecutor(options.fetch ?? globalThis.fetch));
    },
  };
}

function redactHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const safe: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    // Redacted by name rather than by inspecting the value: a bearer token and
    // an ordinary string are indistinguishable once they are strings.
    safe[name] = SENSITIVE_HEADERS.includes(name.toLowerCase()) ? '[redacted]' : value;
  }

  return safe;
}

function createExecutor(fetchImpl: typeof globalThis.fetch): ApiExecutor {
  const exchanges: Exchange[] = [];

  return {
    async send(request: ApiSendRequest): Promise<ApiSendResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, request.timeoutMs);

      let response: Response;

      try {
        response = await fetchImpl(request.url, {
          method: request.method,
          headers: { ...request.headers },
          signal: controller.signal,
        });
      } catch (error) {
        throw new RuntimeError({
          code: 'API_REQUEST_FAILED',
          // The URL is Orbit-built and safe to report. The underlying error is
          // not persisted: it can carry response content.
          message: `The request to ${request.url} did not complete.`,
          cause: error,
        });
      } finally {
        clearTimeout(timer);
      }

      const text = await response.text();
      let body: unknown = null;

      try {
        body = text === '' ? null : JSON.parse(text);
      } catch {
        // A non-JSON response is not a failure here. The step's `assign` block
        // is what decides whether the shape it needed was present.
      }

      exchanges.push({
        method: request.method,
        url: request.url,
        headers: redactHeaders(request.headers),
        status: response.status,
        body:
          text.length > MAX_EVIDENCE_BYTES
            ? `${text.slice(0, MAX_EVIDENCE_BYTES)}\n[truncated]`
            : text,
      });

      return { status: response.status, body, text };
    },

    finishEvidence(): Promise<readonly SurfaceEvidence[]> {
      return Promise.resolve(
        exchanges.length === 0
          ? []
          : [
              {
                kind: 'api_exchange' as const,
                role: 'api_exchange' as const,
                bytes: new TextEncoder().encode(JSON.stringify(exchanges, null, 2)),
              },
            ],
      );
    },

    close(): Promise<void> {
      return Promise.resolve();
    },
  };
}
