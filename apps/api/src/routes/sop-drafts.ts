import { sopDocumentIdSchema } from '@orbit/contracts';
import type { SopGraphIssue } from '@orbit/sop-graph';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { ApiContext } from '../context';
import { ApiError, badRequest, internalError, notFound } from '../errors';
import { toSopDraftView } from '../projections';
import type { DataEnvelope, SopDraftView } from '../views';

/**
 * The free-text SOP input surface (sub-phase 2.2).
 *
 * One route: source text in, a persisted draft revision out. It is deliberately
 * the whole of the surface — there is no step editor, no reorder control, no
 * clarification-answer workflow, and no approve or reject, all of which belong
 * to sub-phase 2.3.
 *
 * Nothing here ever touches a URL that came back inside a graph. `urlHint` and
 * `systemHint` are carried through to storage and to the response as text, and
 * are never fetched, navigated, probed, or resolved (ADR-016).
 */

/**
 * Either new text or an existing document, never both.
 *
 * A document's source text has no update path, so "here is different text for
 * the document you already have" is not a request this API can honour; the
 * union makes it unsendable rather than rejected after the fact. Regenerating a
 * document uses the text it already holds.
 */
const createDraftBodySchema = z.union([
  z.strictObject({ sourceText: z.string().trim().min(1).max(50_000) }),
  z.strictObject({ documentId: sopDocumentIdSchema }),
]);

/**
 * Validation issues, as error details.
 *
 * Each issue keeps its code and its location so a reviewer can see *why* a
 * generated graph was refused, not merely that it was. The Phase 1 taxonomy has
 * no code for "the model produced something unusable", so this reuses
 * VALIDATION_ERROR; widening `@orbit/contracts` is out of scope for this task.
 */
function toErrorDetails(issues: readonly SopGraphIssue[]) {
  return issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : (issue.stepId ?? 'graph'),
    message: `[${issue.code}] ${issue.message}`,
  }));
}

export function registerSopDraftRoutes(app: FastifyInstance, context: ApiContext): void {
  app.post('/v1/sop-drafts', async (request, reply) => {
    const body = createDraftBodySchema.safeParse(request.body ?? {});

    if (!body.success) {
      throw badRequest(
        'The request body must contain either sourceText for a new document or documentId for a new revision.',
        body.error.issues.map((issue) => ({
          field: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }

    const result = await context.sopDraftService.createDraft(
      'sourceText' in body.data
        ? { kind: 'new_document', sourceText: body.data.sourceText }
        : { kind: 'new_revision', documentId: body.data.documentId },
    );

    if (!result.ok) {
      if (result.reason === 'document_not_found') {
        throw notFound(`SOP document "${result.documentId}" does not exist.`);
      }

      if (result.reason === 'provider_error') {
        // Logged in full, reported generically. A provider message can carry an
        // endpoint, a request id, or an account detail, and none of that belongs
        // in a response body.
        request.log.error(
          { reason: result.reason, detail: result.message },
          'SOP generation failed.',
        );
        throw internalError('The SOP could not be generated because the model provider failed.');
      }

      // 422: the request was well-formed and the model was reached; what came
      // back was not a valid SOP Graph even after one repair. Nothing was
      // persisted.
      throw new ApiError({
        code: 'VALIDATION_ERROR',
        statusCode: 422,
        message:
          'The generated SOP Graph did not pass validation, and a repair attempt did not fix it. Nothing was saved.',
        details: toErrorDetails(result.issues),
      });
    }

    const payload: DataEnvelope<SopDraftView> = {
      data: toSopDraftView({ document: result.document, revision: result.revision }),
    };

    return reply.code(201).send(payload);
  });
}
