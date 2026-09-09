import { sopDocumentIdSchema } from '@orbit/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { ApiContext } from '../app/context';
import { ApiError, badRequest, internalError, notFound } from '../errors';
import type { DataEnvelope } from '../views/views';

/**
 * Drafting a business rule into a decision step (ADR-040).
 *
 * One route, and it deliberately writes nothing. It returns a *proposed* step
 * and where it should go; adding it to the revision is the existing
 * insert-step route, called by a person who has read the proposal. Every other
 * generated thing in Orbit works this way — a draft is reviewed before it
 * becomes part of a workflow — and a rule that quietly edited a published
 * lending procedure would be the one exception nobody asked for.
 *
 * It is a POST despite writing nothing, because it spends money: a GET that
 * bills an account is a GET somebody's proxy will retry.
 */

const draftRuleBodySchema = z.strictObject({
  documentId: sopDocumentIdSchema,
  ruleText: z.string().trim().min(1).max(2_000),
});

export interface RuleDraftView {
  /** The proposed step, in the shape the insert-step route accepts. */
  readonly step: Record<string, unknown>;
  readonly insertAfterStepId: string;
  readonly insertAtIndex: number;
}

export function registerRuleDraftRoutes(app: FastifyInstance, context: ApiContext): void {
  app.post('/v1/rule-drafts', async (request, reply) => {
    const body = draftRuleBodySchema.safeParse(request.body ?? {});

    if (!body.success) {
      throw badRequest(
        'The request body must contain a documentId and the rule, in words.',
        body.error.issues.map((issue) => ({
          field: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }

    const result = await context.sopRuleService.draft(body.data);

    if (!result.ok) {
      if (result.reason === 'not_found') {
        throw notFound(`SOP document "${body.data.documentId}" does not exist.`);
      }

      if (result.reason === 'provider_error') {
        // Logged in full, reported generically, for the reason drafting does
        // the same: a provider message can carry an endpoint, a request id, or
        // an account detail, and none of that belongs in a response body.
        request.log.error({ detail: result.message }, 'Rule drafting failed.');
        throw internalError('The rule could not be drafted because the model provider failed.');
      }

      if (result.reason === 'budget_exhausted') {
        throw new ApiError({
          code: 'VALIDATION_ERROR',
          statusCode: 429,
          message: result.refusal.message,
        });
      }

      // 422: the model was reached and answered, and the answer named something
      // this workflow does not have. The refusals say which, because the fix is
      // usually to record a value rather than to reword the rule.
      throw new ApiError({
        code: 'VALIDATION_ERROR',
        statusCode: 422,
        message: 'This rule could not be turned into a step for this workflow. Nothing was saved.',
        details: result.refusals.map((refusal) => ({
          field: refusal.code,
          message: refusal.message,
        })),
      });
    }

    const payload: DataEnvelope<RuleDraftView> = {
      data: {
        step: result.step as unknown as Record<string, unknown>,
        insertAfterStepId: result.insertAfterStepId,
        insertAtIndex: result.insertAtIndex,
      },
    };

    return reply.code(200).send(payload);
  });
}
