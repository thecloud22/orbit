import { sopDocumentIdSchema } from '@orbit/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { ApiContext } from '../app/context';
import { ApiError, badRequest, notFound } from '../errors';
import { toPublishedAgentVersionView } from '../views/projections';
import type { DataEnvelope, PublishedAgentVersionView } from '../views/views';

/**
 * Publishing a recorded workflow in one action.
 *
 * Everything this does, `POST .../candidates` + `.../approve` +
 * `.../publish` already do — this composes them, for the one case where doing
 * so is not standing in for real review: a person demonstrated every action in
 * the workflow personally, in a real browser (`publish-recording-service.ts`
 * explains why that is the right line to draw). This route refuses anything
 * whose provenance is not `recorded`, and everything it produces goes through
 * the same states — revision approved, candidate compiled and approved,
 * version published — the manual path would have produced.
 */

function parseDocumentId(params: unknown): string {
  const parsed = z.object({ documentId: sopDocumentIdSchema }).safeParse(params);

  if (!parsed.success) {
    throw badRequest('That is not a document id.');
  }

  return parsed.data.documentId;
}

/** 422: the request was well formed, but an answer is still missing. */
function unprocessable(message: string, details?: readonly { field: string; message: string }[]) {
  return new ApiError({
    code: 'VALIDATION_ERROR',
    statusCode: 422,
    message,
    ...(details === undefined ? {} : { details }),
  });
}

/**
 * Publishing takes no body.
 *
 * It used to carry an outcome mapping, because a business outcome was one of
 * two names inherited from the Phase 1 demo and somebody had to say which of
 * them each of their workflow's own outcomes meant. Outcomes are now the
 * workflow's own declared names (ADR-030), so there is nothing left to ask.
 * Kept strict rather than dropped so a caller still sending the old field is
 * told, instead of having it silently ignored.
 */
const bodySchema = z.strictObject({});

export function registerPublishRecordingRoutes(app: FastifyInstance, context: ApiContext): void {
  app.post<{ Params: { documentId: string } }>(
    '/v1/sop-documents/:documentId/publish-recording',
    async (request, reply) => {
      const documentId = parseDocumentId(request.params);
      const body = bodySchema.safeParse(request.body ?? {});

      if (!body.success) {
        throw badRequest(
          "Publishing this workflow takes no options. An outcome is the workflow's own declared name.",
          body.error.issues.map((issue) => ({
            field: issue.path.join('.') || 'body',
            message: issue.message,
          })),
        );
      }

      const result = await context.publishRecordingService.publish(documentId as never);

      if (!result.ok) {
        switch (result.reason) {
          case 'not_found':
            throw notFound(`SOP document "${documentId}" does not exist.`);
          case 'not_recorded':
            throw badRequest(
              'This workflow was not recorded, so it needs the ordinary compile-and-approve ' +
                'review rather than the one-step path.',
            );
          case 'questions_unanswered':
            throw unprocessable(
              'Every clarification question must be answered first.',
              result.unansweredQuestionIds.map((questionId) => ({
                field: questionId,
                message: 'This question has not been answered.',
              })),
            );
          case 'revision_not_publishable':
            throw badRequest(`This workflow is ${result.state} and cannot be published.`);
          case 'refused':
            throw badRequest(
              'This workflow could not be fully compiled.',
              result.refusals.map((refusal) => ({
                field: refusal.stepId ?? 'graph',
                message: `[${refusal.code}] ${refusal.message}`,
              })),
            );
          case 'not_ready':
            throw badRequest(
              `This workflow needs a sign-in Orbit cannot perform (${result.sandboxState}), so it ` +
                'cannot be published.',
            );
          case 'already_published':
            return reply.code(409).send({
              data: { agentVersionId: result.agentVersionId },
            } satisfies DataEnvelope<{
              readonly agentVersionId: string;
            }>);
        }
      }

      const payload: DataEnvelope<PublishedAgentVersionView> = {
        data: toPublishedAgentVersionView(result.agentVersion),
      };

      return reply.code(201).send(payload);
    },
  );
}
