import { z } from 'zod';

/**
 * The closed set of API operations a workflow may call.
 *
 * This is ADR-018's argument applied to endpoints. A locator vocabulary is
 * closed so that no raw CSS selector -- a small program for walking the DOM --
 * can be expressed; a URL template with interpolation is a small program for
 * constructing a request, and it has the same problem for the same reason. So a
 * step names an `operationId` in a catalog, never a URL.
 *
 * A catalog is imported from a contract the service already publishes, so what
 * an agent may call is bounded by what its owner documented rather than by what
 * somebody typed into a box.
 */

export const httpMethodSchema = z.enum(['get', 'post', 'put', 'patch', 'delete', 'head']);
export type HttpMethod = z.infer<typeof httpMethodSchema>;

/** Where one value goes in a request. Not a template: a named slot. */
export const parameterLocationSchema = z.enum(['path', 'query', 'header', 'body']);
export type ParameterLocation = z.infer<typeof parameterLocationSchema>;

export const operationParameterSchema = z.strictObject({
  name: z.string().min(1),
  location: parameterLocationSchema,
  required: z.boolean(),
  /** Only string-typed values, matching Agent IR's one value type today. */
  type: z.literal('string'),
});
export type OperationParameter = z.infer<typeof operationParameterSchema>;

export const catalogOperationSchema = z.strictObject({
  operationId: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]*$/),
  method: httpMethodSchema,
  /** The templated path exactly as the contract declares it, e.g. `/requests/{id}`. */
  path: z.string().min(1),
  summary: z.string().optional(),
  parameters: z.array(operationParameterSchema),
  /**
   * Whether calling this twice is the same as calling it once.
   *
   * Derived from the method rather than asserted by a human: `get` and `head`
   * are safe, `put` and `delete` are idempotent by the HTTP spec, `post` and
   * `patch` are not. Phase 3 compiles only the safe ones -- a non-idempotent
   * call needs the idempotency-key design deferred to Phase 5.
   */
  idempotent: z.boolean(),
});
export type CatalogOperation = z.infer<typeof catalogOperationSchema>;

export const apiCatalogSchema = z.strictObject({
  /** Stable identifier for the imported contract, e.g. `service-desk`. */
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  title: z.string().min(1),
  /**
   * The hosts this contract declares.
   *
   * The compiler derives `permissions.api.allowedHosts` from these, exactly as
   * it derives `allowedDomains` from the hosts a recording visited (ADR-022).
   */
  hosts: z.array(z.string().min(1)).min(1),
  operations: z.array(catalogOperationSchema).min(1),
});
export type ApiCatalog = z.infer<typeof apiCatalogSchema>;

export const SAFE_METHODS: readonly HttpMethod[] = ['get', 'head'];
export const IDEMPOTENT_METHODS: readonly HttpMethod[] = ['get', 'head', 'put', 'delete'];

export function operationById(
  catalog: ApiCatalog,
  operationId: string,
): CatalogOperation | undefined {
  return catalog.operations.find((operation) => operation.operationId === operationId);
}
