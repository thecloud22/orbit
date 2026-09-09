import { agentIrCandidateIdSchema } from '@orbit/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { ApiContext } from '../app/context';
import { badRequest, notFound } from '../errors';
import { toPublishedAgentVersionView } from '../views/projections';
import type { DataEnvelope, PublishedAgentVersionView } from '../views/views';

/**
 * Publishing an approved candidate as a runnable Agent Version.
 *
 * The route returns the agent it created rather than a changed SOP document,
 * because publishing does not change the document. A SOP Graph is
 * non-executable by construction (ADR-016) and stays that way afterwards; what
 * became executable is a separate artifact, and the review page links to it.
 */
export function registerPublishingRoutes(app: FastifyInstance, context: ApiContext): void {
  app.post<{ Params: { candidateId: string } }>(
    '/v1/agent-ir-candidates/:candidateId/publish',
    async (request, reply) => {
      const parsed = z.object({ candidateId: agentIrCandidateIdSchema }).safeParse(request.params);

      if (!parsed.success) {
        throw badRequest('That is not a candidate id.');
      }

      const result = await context.sopPublishService.publish(parsed.data.candidateId);

      if (!result.ok) {
        if (result.reason === 'not_found') {
          throw notFound('That candidate does not exist.');
        }

        if (result.reason === 'not_approved') {
          throw badRequest(
            `This workflow is ${result.state}. Only an approved candidate can be published, ` +
              'because publishing is what makes it runnable.',
          );
        }

        // Not an error: the thing the caller wanted already exists. The id is
        // returned so the UI can link to it rather than report a failure.
        const payload: DataEnvelope<{ readonly agentVersionId: string }> = {
          data: { agentVersionId: result.agentVersionId },
        };
        return reply.code(409).send(payload);
      }

      const payload: DataEnvelope<PublishedAgentVersionView> = {
        data: toPublishedAgentVersionView(result.agentVersion),
      };

      return reply.code(201).send(payload);
    },
  );
}
