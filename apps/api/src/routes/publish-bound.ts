import { sopDocumentIdSchema, terminalBusinessOutcomeSchema } from '@orbit/contracts';
import { outcomeNameSchema } from '@orbit/sop-graph';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { ApiContext } from '../context';
import { ApiError, badRequest, notFound } from '../errors';
import { toPublishedAgentVersionView } from '../projections';
import type { DataEnvelope, PublishedAgentVersionView } from '../views';

/**
 * Publishing a drafted workflow whose every step has been bound, in one action.
 *
 * The same shape as `publish-recording.ts` with a different precondition, and
 * the two are deliberately separate routes rather than one with a mode. A
 * recording confirms a workflow against a real page all at once; binding
 * confirms it one step at a time (ADR-027). Once every bindable step carries an
 * approved, non-stale binding, the same confirmation exists.
 *
 * The gate is technical rather than a review waiver: `compileDocument` already
 * refuses a document with a missing binding, so this cannot make a
 * partially-bound draft publishable — it only stops one being walked through
 * approval on the way to a refusal, and names the steps still to bind.
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

const bodySchema = z.strictObject({
  outcomeMapping: z.record(outcomeNameSchema, terminalBusinessOutcomeSchema),
});

export function registerPublishBoundRoutes(app: FastifyInstance, context: ApiContext): void {
  app.post<{ Params: { documentId: string } }>(
    '/v1/sop-documents/:documentId/publish-bound',
    async (request, reply) => {
      const documentId = parseDocumentId(request.params);
      const body = bodySchema.safeParse(request.body ?? {});

      if (!body.success) {
        throw badRequest(
          'This needs an outcome mapping.',
          body.error.issues.map((issue) => ({
            field: issue.path.join('.') || 'body',
            message: issue.message,
          })),
        );
      }

      const result = await context.publishBoundDocumentService.publish(
        documentId as never,
        body.data.outcomeMapping,
      );

      if (!result.ok) {
        switch (result.reason) {
          case 'not_found':
            throw notFound(`SOP document "${documentId}" does not exist.`);
          case 'not_fully_bound':
            throw unprocessable(
              'Every step of this workflow has to be bound to a real page before it can be ' +
                'published.',
              result.unboundStepIds.map((stepId) => ({
                field: stepId,
                message: 'This step has no approved, up-to-date binding.',
              })),
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
