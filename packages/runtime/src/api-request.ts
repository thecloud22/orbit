import { type ApiCatalog, type CatalogOperation } from '@orbit/api-catalog';

import { RuntimeError } from './errors';

/**
 * Building the request an operation describes.
 *
 * Every value comes from a *named* parameter the contract declared, filled into
 * a slot. Nothing here concatenates a URL from workflow-supplied text: a path
 * parameter is encoded into its own segment and a query parameter through
 * `URLSearchParams`, so a value cannot escape into the structure of the request.
 */
export function buildRequestUrl(
  catalog: ApiCatalog,
  operation: CatalogOperation,
  args: Readonly<Record<string, string>>,
  agentStepId: string,
): URL {
  let path = operation.path;

  for (const parameter of operation.parameters) {
    const value = args[parameter.name];

    if (value === undefined) {
      if (parameter.required) {
        throw new RuntimeError({
          code: 'API_REQUEST_FAILED',
          message: `Step "${agentStepId}" omits required parameter "${parameter.name}".`,
          agentStepId,
        });
      }
      continue;
    }

    if (parameter.location === 'path') {
      path = path.replace(`{${parameter.name}}`, encodeURIComponent(value));
    }
  }

  if (catalog.baseUrl === undefined) {
    throw new RuntimeError({
      code: 'API_REQUEST_FAILED',
      message: `Catalog "${catalog.id}" declares no server URL.`,
      agentStepId,
    });
  }

  // Built from the contract's declared server, scheme and port included. This
  // used to assemble `https://${hosts[0]}`, which silently rewrote every call:
  // a contract served from `http://localhost:3020` was requested over HTTPS on
  // port 443, and the only symptom was a connection that did not complete.
  const url = new URL(`${catalog.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);

  for (const parameter of operation.parameters) {
    const value = args[parameter.name];
    if (parameter.location === 'query' && value !== undefined) {
      url.searchParams.set(parameter.name, value);
    }
  }

  return url;
}

export function headersFrom(
  operation: CatalogOperation,
  args: Readonly<Record<string, string>>,
): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' };

  for (const parameter of operation.parameters) {
    const value = args[parameter.name];
    if (parameter.location === 'header' && value !== undefined) {
      headers[parameter.name] = value;
    }
  }

  return headers;
}

/**
 * Reads one value out of a response by JSON Pointer (RFC 6901).
 *
 * A pointer walks a path and cannot express a filter, a wildcard, or a
 * computation — which is exactly why it is here and JSONPath is not (ADR-007).
 * Returns a string because Agent IR has one value type; a non-scalar at the end
 * of a pointer is reported as absent rather than stringified into something a
 * workflow would then compare against.
 */
export function readJsonPointer(body: unknown, pointer: string): string | undefined {
  const segments = pointer
    .split('/')
    .slice(1)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));

  let current: unknown = body;

  for (const segment of segments) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }

    current = Array.isArray(current)
      ? current[Number.parseInt(segment, 10)]
      : (current as Record<string, unknown>)[segment];
  }

  if (typeof current === 'string') return current;
  if (typeof current === 'number' || typeof current === 'boolean') return String(current);
  return undefined;
}

/** The last gate before an API call leaves the machine. */
export function assertApiHost(
  url: URL,
  allowedHosts: readonly string[],
  agentStepId: string,
): void {
  if (!allowedHosts.includes(url.hostname)) {
    throw new RuntimeError({
      code: 'API_REQUEST_FAILED',
      message: `Step "${agentStepId}" calls a host the Agent Version does not permit.`,
      details: [{ field: 'url.hostname', message: url.hostname }],
      agentStepId,
    });
  }
}
