import { executionBindingIdSchema } from '@orbit/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { ApiContext } from '../context';
import { badRequest, notFound } from '../errors';
import { toExecutionBindingReviewView } from '../projections';
import type { DataEnvelope, ExecutionBindingReviewView } from '../views';

/**
 * Approving or rejecting a binding nobody has confirmed yet.
 *
 * Every binding a person demonstrates themselves is approved in the same
 * sitting (`createBinding`'s `confirmedByDemonstration`), so this route
 * exists for the other case: a binding demonstrated or proposed by someone
 * other than the person now reviewing it. The state machine
 * (`draft -> needs_review -> approved | rejected`) has existed in the
 * repository since Execution Bindings were introduced; nothing until this
 * route could reach it from Watchtower.
 *
 * Collapses `draft -> needs_review` into the same call rather than a
 * separate "submit for review" step first -- see `binding-service.ts`'s
 * `reviewBinding` for why.
 */

function parseBindingId(params: unknown): string {
  const parsed = z.object({ bindingId: executionBindingIdSchema }).safeParse(params);

  if (!parsed.success) {
    throw badRequest('That is not a binding id.');
  }

  return parsed.data.bindingId;
}

const reviewBodySchema = z.strictObject({
  note: z.string().trim().min(1).max(2000).optional(),
});

export function registerExecutionBindingRoutes(app: FastifyInstance, context: ApiContext): void {
  app.post<{ Params: { bindingId: string } }>(
    '/v1/execution-bindings/:bindingId/approve',
    async (request, reply) => {
      const bindingId = parseBindingId(request.params);
      const body = reviewBodySchema.safeParse(request.body ?? {});

      if (!body.success) {
        throw badRequest('That is not a valid approval note.');
      }

      const result = await context.bindingReview.approve(bindingId as never, body.data.note);

      if (!result.ok) {
        if (result.reason === 'not_found') {
          throw notFound(`Execution binding "${bindingId}" does not exist.`);
        }

        throw badRequest(
          `This binding is "${result.state}", and only a draft or a binding waiting for review may be approved.`,
        );
      }

      const payload: DataEnvelope<ExecutionBindingReviewView> = {
        data: toExecutionBindingReviewView(result.binding),
      };

      return reply.code(200).send(payload);
    },
  );

  app.post<{ Params: { bindingId: string } }>(
    '/v1/execution-bindings/:bindingId/reject',
    async (request, reply) => {
      const bindingId = parseBindingId(request.params);
      const body = reviewBodySchema.safeParse(request.body ?? {});

      if (!body.success) {
        throw badRequest('That is not a valid rejection note.');
      }

      const result = await context.bindingReview.reject(bindingId as never, body.data.note);

      if (!result.ok) {
        if (result.reason === 'not_found') {
          throw notFound(`Execution binding "${bindingId}" does not exist.`);
        }

        throw badRequest(
          `This binding is "${result.state}", and only a draft or a binding waiting for review may be rejected.`,
        );
      }

      const payload: DataEnvelope<ExecutionBindingReviewView> = {
        data: toExecutionBindingReviewView(result.binding),
      };

      return reply.code(200).send(payload);
    },
  );
}
