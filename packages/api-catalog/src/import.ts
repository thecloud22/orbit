import {
  apiCatalogSchema,
  httpMethodSchema,
  IDEMPOTENT_METHODS,
  type ApiCatalog,
  type CatalogOperation,
  type OperationParameter,
} from './catalog';

/**
 * Turning an OpenAPI document into a catalog, refusing what it cannot resolve.
 *
 * The same stance the Agent IR compiler takes (ADR-021): every operation that
 * cannot be fully understood is *named* as a refusal rather than partially
 * imported. A half-understood operation in a catalog is worse than an absent
 * one, because it looks callable.
 *
 * Deliberately not a general OpenAPI implementation. `$ref`, `oneOf`,
 * polymorphic bodies and non-string parameters are all refused rather than
 * approximated -- Agent IR has one value type, so an operation needing more than
 * strings cannot be expressed by a step even if it could be parsed here.
 */

export interface ImportRefusal {
  readonly operationId: string;
  readonly reason:
    | 'unsupported_method'
    | 'unsupported_parameter_type'
    | 'unresolved_reference'
    | 'missing_operation_id'
    | 'not_idempotent';
  readonly detail: string;
}

export type ImportResult =
  | { readonly ok: true; readonly catalog: ApiCatalog; readonly refusals: readonly ImportRefusal[] }
  | { readonly ok: false; readonly refusals: readonly ImportRefusal[]; readonly message: string };

interface RawDocument {
  readonly info?: { readonly title?: string };
  readonly servers?: readonly { readonly url?: string }[];
  readonly paths?: Record<string, Record<string, unknown>>;
}

/** The first declared server, which is what a request is built against. */
function baseUrlOf(document: RawDocument): string | undefined {
  for (const server of document.servers ?? []) {
    if (server.url === undefined) {
      continue;
    }

    try {
      // Normalised through URL so a trailing slash cannot double up when a
      // path is appended.
      return new URL(server.url).toString().replace(/\/$/, '');
    } catch {
      continue;
    }
  }

  return undefined;
}

function hostsOf(document: RawDocument): readonly string[] {
  const hosts: string[] = [];

  for (const server of document.servers ?? []) {
    if (server.url === undefined) continue;

    try {
      hosts.push(new URL(server.url).hostname);
    } catch {
      // A relative or templated server URL names no host. Skipped rather than
      // guessed: the catalog's hosts become a permission grant.
    }
  }

  return [...new Set(hosts)];
}

export function importOpenApi(id: string, document: unknown): ImportResult {
  const raw = document as RawDocument;
  const refusals: ImportRefusal[] = [];
  const operations: CatalogOperation[] = [];

  for (const [path, methods] of Object.entries(raw.paths ?? {})) {
    for (const [method, definition] of Object.entries(methods)) {
      const parsedMethod = httpMethodSchema.safeParse(method.toLowerCase());
      const operation = definition as {
        operationId?: string;
        summary?: string;
        parameters?: readonly Record<string, unknown>[];
      };
      const operationId = operation.operationId;

      if (!parsedMethod.success) {
        continue; // `parameters`, `summary` and other non-method keys.
      }

      if (operationId === undefined) {
        refusals.push({
          operationId: `${method.toUpperCase()} ${path}`,
          reason: 'missing_operation_id',
          detail: 'An operation without an operationId cannot be named by a step.',
        });
        continue;
      }

      if (!IDEMPOTENT_METHODS.includes(parsedMethod.data)) {
        refusals.push({
          operationId,
          reason: 'not_idempotent',
          detail: `${parsedMethod.data.toUpperCase()} needs the idempotency-key design deferred to Phase 5.`,
        });
        continue;
      }

      const parameters: OperationParameter[] = [];
      let refused = false;

      for (const parameter of operation.parameters ?? []) {
        if ('$ref' in parameter) {
          refusals.push({
            operationId,
            reason: 'unresolved_reference',
            detail: 'A $ref parameter is not resolved rather than being guessed at.',
          });
          refused = true;
          break;
        }

        const schema = parameter['schema'] as { type?: string } | undefined;

        if (schema?.type !== 'string') {
          refusals.push({
            operationId,
            reason: 'unsupported_parameter_type',
            detail: `Parameter "${String(parameter['name'])}" is ${schema?.type ?? 'untyped'}; Agent IR values are strings.`,
          });
          refused = true;
          break;
        }

        parameters.push({
          name: String(parameter['name']),
          location:
            parameter['in'] === 'path' ? 'path' : parameter['in'] === 'header' ? 'header' : 'query',
          required: parameter['required'] === true,
          type: 'string',
        });
      }

      if (refused) continue;

      operations.push({
        operationId,
        method: parsedMethod.data,
        path,
        ...(operation.summary === undefined ? {} : { summary: operation.summary }),
        parameters,
        idempotent: true,
      });
    }
  }

  const hosts = hostsOf(raw);
  const baseUrl = baseUrlOf(raw);

  if (operations.length === 0) {
    return { ok: false, refusals, message: 'No operation in this document could be imported.' };
  }

  if (hosts.length === 0) {
    return {
      ok: false,
      refusals,
      message: 'This document declares no absolute server URL, so no host could be permitted.',
    };
  }

  const catalog = apiCatalogSchema.safeParse({
    id,
    title: raw.info?.title ?? id,
    hosts,
    baseUrl,
    operations,
  });

  return catalog.success
    ? { ok: true, catalog: catalog.data, refusals }
    : { ok: false, refusals, message: catalog.error.issues[0]?.message ?? 'invalid catalog' };
}
