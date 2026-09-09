import { importOpenApi } from '@orbit/api-catalog';
import { apiSystemIdSchema } from '@orbit/contracts';
import { environmentVariableFor } from '@orbit/credentials';
import type { FastifyInstance } from 'fastify';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import type { ApiContext } from '../app/context';
import { badRequest, conflict } from '../errors';

/**
 * Registering the API contracts this deployment can call.
 *
 * These are the first write controls Admin has, and the boundary is narrow on
 * purpose (ADR-039). What can be written here is a *contract* and the *name* of
 * a credential. What cannot is any secret value, any permission, and anything
 * belonging to a published Agent Version.
 *
 * The distinction that makes this safe in an app with no authentication:
 * registering a contract grants nothing. A workflow still has to name an
 * operation, a reviewer still has to approve the binding, and the compiled
 * version still carries its own immutable grant. Someone who registered a
 * hostile contract here would have added an option nobody had chosen.
 *
 * Every failure here is thrown as an `ApiError` and caught by the server's
 * shared error handler, rather than built by hand with `reply.send()`. That is
 * not a style preference: a hand-built body is a second, silent error format
 * that the shared taxonomy and the client's error parser both know nothing
 * about. This route did that in one place for its Zod validation failure —
 * `{ error: { code, issues } }`, no `message` — and the client's `toApiError`
 * only ever reads `error.message`, so that one path rendered as blank or fell
 * through to a generic "could not be reached," which is exactly what surfaced
 * when a person hit it. A second place invented `code: 'CONFLICT'`, which is
 * not in the closed `ErrorCode` taxonomy at all and would have failed silently
 * had anything actually validated it against the schema.
 */

const createSchema = z.strictObject({
  catalogId: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  name: z.string().min(1),
  /** An OpenAPI document, YAML or JSON. Parsed here, never fetched. */
  spec: z.string().min(1),
  authScheme: z.enum(['none', 'bearer', 'basic']).default('none'),
  credentialRef: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/)
    .optional(),
  authHeaderName: z.string().min(1).optional(),
});

export function registerApiSystemRoutes(app: FastifyInstance, context: ApiContext): void {
  const repositories = context.repositories;

  app.get('/v1/api-systems', async () => {
    const rows = await repositories.apiSystems.list();

    // Wrapped in `data`, matching every other GET route (`/v1/agent-versions`
    // and the rest). This was the actual defect a live registration attempt
    // surfaced: the client's shared `getJson()` helper unconditionally reads
    // `body.data`, so a bare `{ systems: [...] }` response made every
    // successful call resolve to `undefined`, and `result.systems` inside the
    // caller's `.then()` threw -- caught silently by that same promise
    // chain's `.catch()`, with no console error and a 200 on the wire the
    // whole time. Confirmed by driving a real browser: the request always
    // succeeded with the right body, and the page still rendered failure.
    return {
      data: {
        systems: rows.map((row) => {
          const imported = importOpenApi(row.catalogId, safeParse(row.specText));

          return {
            id: row.id,
            catalogId: row.catalogId,
            name: row.name,
            authScheme: row.authScheme,
            credentialRef: row.credentialRef,
            /**
             * Whether the deployment supplies the credential — never what it is.
             *
             * The one thing an operator needs to know from a screen, and the one
             * thing that must never appear on one. Reported as a boolean derived
             * from the environment at request time (ADR-038).
             */
            credentialConfigured:
              row.credentialRef === null
                ? null
                : (process.env[environmentVariableFor(row.credentialRef)] ?? '') !== '',
            credentialVariable:
              row.credentialRef === null ? null : environmentVariableFor(row.credentialRef),
            hosts: imported.ok ? imported.catalog.hosts : [],
            operations: imported.ok
              ? imported.catalog.operations.map((operation) => ({
                  operationId: operation.operationId,
                  method: operation.method,
                  path: operation.path,
                  summary: operation.summary ?? null,
                  parameters: operation.parameters,
                }))
              : [],
            // Shown rather than hidden: an operation that was skipped is
            // something a reviewer needs to see, not a silent absence.
            refusals: imported.refusals,
            importError: imported.ok ? null : imported.message,
          };
        }),
      },
    };
  });

  app.post('/v1/api-systems', async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);

    if (!parsed.success) {
      throw badRequest(
        'The registration form has a problem: ' +
          parsed.error.issues
            .map((issue) => `${issue.path.join('.') || '(root)'} — ${issue.message}`)
            .join('; '),
        parsed.error.issues.map((issue) => ({
          field: issue.path.join('.') || '(root)',
          message: issue.message,
        })),
      );
    }

    const input = parsed.data;

    if (input.authScheme !== 'none' && input.credentialRef === undefined) {
      throw badRequest('An authenticated system must name the credential it uses.');
    }

    const imported = importOpenApi(input.catalogId, safeParse(input.spec));

    if (!imported.ok) {
      // Refused at registration rather than at compile time. A contract nothing
      // can import is not a system anybody can use, and finding that out while
      // authoring a workflow is finding it out too late.
      throw badRequest(
        imported.message,
        imported.refusals.map((refusal) => ({
          field: refusal.operationId,
          message: refusal.detail,
        })),
      );
    }

    if ((await repositories.apiSystems.byCatalogId(input.catalogId)) !== undefined) {
      throw conflict(`"${input.catalogId}" is already registered.`);
    }

    const created = await repositories.apiSystems.create({
      catalogId: input.catalogId,
      name: input.name,
      specText: input.spec,
      authScheme: input.authScheme,
      ...(input.credentialRef === undefined ? {} : { credentialRef: input.credentialRef }),
      ...(input.authHeaderName === undefined ? {} : { authHeaderName: input.authHeaderName }),
    });

    return reply.status(201).send({ id: created.id, catalogId: created.catalogId });
  });

  app.delete('/v1/api-systems/:id', async (request, reply) => {
    const id = apiSystemIdSchema.safeParse((request.params as { id?: string }).id);

    if (!id.success) {
      throw badRequest('This is not a valid Orbit identifier.');
    }

    // Published versions are untouched: their grant is compiled in, so an agent
    // already running keeps working against a system nobody can author with any
    // more. That asymmetry is deliberate (ADR-005).
    const removed = await repositories.apiSystems.remove(id.data);
    return removed ? reply.status(204).send() : reply.status(404).send();
  });
}

function safeParse(text: string): unknown {
  try {
    return parseYaml(text);
  } catch {
    return {};
  }
}
