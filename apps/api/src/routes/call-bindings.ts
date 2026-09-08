import { importOpenApi, operationById } from '@orbit/api-catalog';
import { sopDocumentIdSchema } from '@orbit/contracts';
import { stepChecksum } from '@orbit/db/checksum';
import type { FastifyInstance } from 'fastify';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import type { ApiContext } from '../context';
import { badRequest, notFound } from '../errors';

/**
 * Mapping a `call` step to an operation.
 *
 * The terminal and browser surfaces bind by *demonstration*: a person performs
 * the action and Orbit captures what they touched. An API call has nothing to
 * demonstrate — the contract already states what exists — so binding one is a
 * declaration a person makes against a contract Orbit holds, and this route is
 * where that declaration is checked.
 *
 * It is checked rather than trusted. The operation must exist in a registered
 * catalog, every required parameter must have a source, and every source must
 * name something the graph actually declares. A binding that fails any of those
 * is refused here rather than stored for the compiler to refuse later, because a
 * mapping nobody can compile is not a mapping anybody should be told they made.
 *
 * Created `approved`, unlike a demonstrated binding. The review a browser
 * binding needs asks "is this really the element you meant?", a question about
 * an observation that could have captured the wrong thing. There is no
 * equivalent question here: the person chose an operation from a list and named
 * where each argument comes from, and this route has just verified all of it.
 */

const bodySchema = z.strictObject({
  catalogId: z.string().min(1),
  operationId: z.string().min(1),
  /** Parameter name to where its value comes from. */
  arguments: z
    .record(
      z.string().min(1),
      z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('input'), inputId: z.string().min(1) }),
        z.strictObject({ kind: z.literal('variable'), name: z.string().min(1) }),
        z.strictObject({ kind: z.literal('literal'), value: z.string() }),
      ]),
    )
    .default({}),
  /** Graph variable to a JSON Pointer into the response body. */
  reads: z
    .record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/), z.string().startsWith('/'))
    .default({}),
});

export function registerCallBindingRoutes(app: FastifyInstance, context: ApiContext): void {
  app.post<{ Params: { documentId: string; stepId: string } }>(
    '/v1/sop-documents/:documentId/steps/:stepId/call-binding',
    async (request, reply) => {
      const params = z
        .object({ documentId: sopDocumentIdSchema, stepId: z.string().min(1) })
        .safeParse(request.params);

      if (!params.success) {
        throw badRequest('The document id is not a valid Orbit identifier.');
      }

      const body = bodySchema.safeParse(request.body);

      if (!body.success) {
        throw badRequest('The call mapping is not well formed.');
      }

      const { documentId, stepId } = params.data;
      const revision = await context.repositories.sopGraphRevisions.findCurrent(documentId);

      if (revision === null) {
        throw notFound(`SOP document "${documentId}" does not exist.`);
      }

      const step = revision.graph.steps.find((candidate) => candidate.id === stepId);

      if (step === undefined || step.kind !== 'call') {
        throw badRequest(`Step "${stepId}" is not a call step.`);
      }

      const system = await context.repositories.apiSystems.byCatalogId(body.data.catalogId);

      if (system === undefined) {
        throw badRequest(`No API system is registered as "${body.data.catalogId}".`);
      }

      const imported = importOpenApi(system.catalogId, parseYamlSafely(system.specText));

      if (!imported.ok) {
        throw badRequest(`The contract for "${system.catalogId}" no longer imports.`);
      }

      const operation = operationById(imported.catalog, body.data.operationId);

      if (operation === undefined) {
        throw badRequest(
          `"${body.data.operationId}" is not an operation this deployment can call. It may be one the import refused.`,
        );
      }

      // Every required parameter must have somewhere to come from, and every
      // source must name something the graph declares. Both checked before
      // anything is stored.
      // `inputs` is an array of declarations keyed by `id`, not a record. Read
      // as a record it silently yields "0", "1" and refuses every real name.
      const declaredInputs = new Set(revision.graph.inputs.map((one) => one.id));

      for (const parameter of operation.parameters) {
        const source = body.data.arguments[parameter.name];

        if (source === undefined) {
          if (parameter.required) {
            throw badRequest(`Required parameter "${parameter.name}" has no source.`);
          }
          continue;
        }

        if (source.kind === 'input' && !declaredInputs.has(source.inputId)) {
          throw badRequest(`"${source.inputId}" is not an input this workflow declares.`);
        }
      }

      const existing = await context.repositories.executionBindings.findCurrent(documentId, stepId);

      const created = await context.repositories.executionBindings.create({
        documentId,
        binding: {
          schemaVersion: '0.2',
          stepId,
          capturedAgainstRevisionId: revision.id,
          stepSha256: stepChecksum(step),
          body: {
            kind: 'call',
            catalogId: system.catalogId,
            operationId: operation.operationId,
            arguments: body.data.arguments,
            reads: body.data.reads,
            ...(system.authScheme === 'none' || system.credentialRef === null
              ? {}
              : {
                  auth: {
                    scheme: system.authScheme as 'bearer' | 'basic',
                    credentialRef: system.credentialRef,
                    ...(system.authHeaderName === null
                      ? {}
                      : { headerName: system.authHeaderName }),
                  },
                }),
          },
        },
        // Re-mapping supersedes the previous mapping in the same transaction,
        // exactly as re-recording a step does.
        ...(existing === null ? {} : { parentBindingId: existing.id }),
      });

      // Created `draft` like any binding, then walked to `approved` through the
      // same transitions a demonstrated one takes. The state machine is not
      // bypassed -- what differs is that nobody has to look at a page to decide,
      // because this route already checked everything there was to check.
      await context.repositories.executionBindings.submitForReview(created.id);
      const approved = await context.repositories.executionBindings.approve(created.id, {
        reviewNote: `Mapped to ${operation.method.toUpperCase()} ${operation.path} in "${system.catalogId}".`,
      });

      return reply.status(201).send({
        id: approved.id,
        stepId,
        operationId: operation.operationId,
        state: approved.state,
      });
    },
  );
}

function parseYamlSafely(text: string): unknown {
  try {
    return parseYaml(text);
  } catch {
    return {};
  }
}
