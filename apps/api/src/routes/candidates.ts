import {
  agentIrCandidateIdSchema,
  sopDocumentIdSchema,
  terminalBusinessOutcomeSchema,
} from '@orbit/contracts';
import { outcomeNameSchema } from '@orbit/sop-graph';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { ApiContext } from '../context';
import { badRequest, notFound } from '../errors';
import { toCandidateActionView } from '../projections';
import type { CandidateActionView, DataEnvelope } from '../views';

/**
 * Turning a reviewed workflow into a candidate agent, and approving it.
 *
 * This is the surface sub-phase 2.5 shipped without: `compileDocument` and
 * `approve` existed only as service calls a test could make. Exposing them
 * here is what makes the Publish action on the review page reachable from
 * Watchtower at all, rather than only for a candidate created by hand.
 *
 * Neither route changes the SOP document. Compiling reads an approved revision
 * and its bindings and produces a separate candidate row; approving moves that
 * row through its own lifecycle. The document's `executable` stays `false`
 * throughout, exactly as it does after publishing (ADR-016).
 */

function parseDocumentId(params: unknown): string {
  const parsed = z.object({ documentId: sopDocumentIdSchema }).safeParse(params);

  if (!parsed.success) {
    throw badRequest('That is not a document id.');
  }

  return parsed.data.documentId;
}

function parseCandidateId(params: unknown): string {
  const parsed = z.object({ candidateId: agentIrCandidateIdSchema }).safeParse(params);

  if (!parsed.success) {
    throw badRequest('That is not a candidate id.');
  }

  return parsed.data.candidateId;
}

const compileBodySchema = z.strictObject({
  // Keys are the SOP Graph's own outcome-step vocabulary; values are the
  // closed Phase 1 enum the runtime can actually declare (ADR-023).
  outcomeMapping: z.record(outcomeNameSchema, terminalBusinessOutcomeSchema),
});

const approveBodySchema = z.strictObject({
  note: z.string().trim().min(1).max(2000).optional(),
});

export function registerCandidateRoutes(app: FastifyInstance, context: ApiContext): void {
  app.post<{ Params: { documentId: string } }>(
    '/v1/sop-documents/:documentId/candidates',
    async (request, reply) => {
      const documentId = parseDocumentId(request.params);
      const body = compileBodySchema.safeParse(request.body ?? {});

      if (!body.success) {
        throw badRequest(
          'A compile request needs an outcome mapping.',
          body.error.issues.map((issue) => ({
            field: issue.path.join('.') || 'body',
            message: issue.message,
          })),
        );
      }

      const result = await context.sopCandidateService.compileDocument({
        documentId: documentId as never,
        outcomeMapping: body.data.outcomeMapping,
      });

      if (!result.ok) {
        if (result.reason === 'not_found') {
          throw notFound(`SOP document "${documentId}" does not exist.`);
        }

        if (result.reason === 'no_approved_revision') {
          throw badRequest('This document has no revision yet, so there is nothing to compile.');
        }

        if (result.reason === 'revision_not_approved') {
          throw badRequest(
            `This workflow's current revision is ${result.state}. Only an approved revision can ` +
              'be turned into an agent — approve it in review first.',
          );
        }

        // Refused: the workflow is understood but cannot be compiled completely
        // yet. Not an error in the sense of something having gone wrong; every
        // refusal names a step and a reason (ADR-021).
        throw badRequest(
          'This workflow could not be fully compiled.',
          result.refusals.map((refusal) => ({
            field: refusal.stepId ?? 'graph',
            message: `[${refusal.code}] ${refusal.message}`,
          })),
        );
      }

      const payload: DataEnvelope<CandidateActionView> = {
        data: toCandidateActionView(result.candidate),
      };

      return reply.code(201).send(payload);
    },
  );

  app.post<{ Params: { candidateId: string } }>(
    '/v1/agent-ir-candidates/:candidateId/approve',
    async (request, reply) => {
      const candidateId = parseCandidateId(request.params);
      const body = approveBodySchema.safeParse(request.body ?? {});

      if (!body.success) {
        throw badRequest('That is not a valid approval note.');
      }

      const result = await context.sopCandidateService.approve(
        candidateId as never,
        body.data.note,
      );

      if (!result.ok) {
        if (result.reason === 'not_found') {
          throw notFound(`Candidate "${candidateId}" does not exist.`);
        }

        if (result.reason === 'not_ready') {
          throw badRequest(
            `This workflow could not be checked (${result.sandboxState}), so it cannot be approved.`,
          );
        }

        throw badRequest(
          `This candidate is ${result.state}, and only a freshly compiled candidate may be approved.`,
        );
      }

      const payload: DataEnvelope<CandidateActionView> = {
        data: toCandidateActionView(result.candidate),
      };

      return reply.code(200).send(payload);
    },
  );
}
