import { bindingRecoveryProposalIdSchema, sopDocumentIdSchema } from '@orbit/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { ApiContext } from '../app/context';
import { ApiError, badRequest, notFound } from '../errors';
import { toRecoveryProposalView } from '../views/projections';
import type { DataEnvelope, RecoveryProposalsView, RecoveryProposalView } from '../views/views';

/**
 * Recovery proposals, and the one action that resolves them (ADR-033).
 *
 * There is a write path here, unlike `sop-bindings.ts`, and it is worth saying
 * exactly what it can do. `accept` creates a binding through the ordinary
 * lifecycle — the same `create` -> `submitForReview` -> `approve` a person
 * recording a step goes through — and marks the proposal accepted. It cannot
 * publish, cannot touch an Agent Version, and cannot make a mapping live
 * without a person calling it. `dismiss` closes a proposal and changes nothing
 * else.
 *
 * What is deliberately absent is an endpoint that applies a proposal
 * automatically, or one that re-runs the workflow after accepting. Accepting
 * makes the next run possible; starting that run stays a separate, human act.
 */

function parseDocumentId(params: unknown): string {
  const parsed = z.object({ documentId: sopDocumentIdSchema }).safeParse(params);

  if (!parsed.success) {
    throw badRequest('That is not a document id.');
  }

  return parsed.data.documentId;
}

function parseProposalId(params: unknown): string {
  const parsed = z.object({ proposalId: bindingRecoveryProposalIdSchema }).safeParse(params);

  if (!parsed.success) {
    throw badRequest('That is not a recovery proposal id.');
  }

  return parsed.data.proposalId;
}

/** 409: the proposal was real, but the world moved on under it. */
function conflict(message: string): ApiError {
  return new ApiError({ code: 'VALIDATION_ERROR', statusCode: 409, message });
}

const resolveBodySchema = z.strictObject({ note: z.string().min(1).max(500).optional() });
const grantBodySchema = z.strictObject({ enabled: z.boolean() });

export function registerRecoveryRoutes(app: FastifyInstance, context: ApiContext): void {
  app.get<{ Params: { documentId: string } }>(
    '/v1/sop-documents/:documentId/recovery-proposals',
    async (request) => {
      const documentId = parseDocumentId(request.params);
      const enabled = await context.recoveryProposals.isEnabled(documentId as never);

      if (enabled === null) {
        throw notFound(`SOP document "${documentId}" does not exist.`);
      }

      const proposals = await context.recoveryProposals.listOpen(documentId as never);

      const payload: DataEnvelope<RecoveryProposalsView> = {
        data: {
          documentId,
          recoveryEnabled: enabled,
          proposals: proposals.map(toRecoveryProposalView),
        },
      };

      return payload;
    },
  );

  app.post<{ Params: { documentId: string; proposalId: string }; Body: unknown }>(
    '/v1/sop-documents/:documentId/recovery-proposals/:proposalId/accept',
    async (request) => {
      parseDocumentId(request.params);
      const proposalId = parseProposalId(request.params);
      const body = resolveBodySchema.safeParse(request.body ?? {});

      if (!body.success) {
        throw badRequest('The note must be a short string.');
      }

      const result = await context.recoveryProposals.accept(proposalId as never, body.data.note);

      if (!result.ok) {
        if (result.reason === 'not_found') {
          throw notFound(result.message);
        }

        // Everything else is the world having moved: the step was re-recorded,
        // edited, or the proposal was already resolved. All refusals, none
        // repairs — a stale proposal is withdrawn, never adjusted to fit.
        throw conflict(result.message);
      }

      const payload: DataEnvelope<{ bindingId: string; stepId: string; state: string }> = {
        data: {
          bindingId: result.binding.id,
          stepId: result.binding.stepId,
          state: result.binding.state,
        },
      };

      return payload;
    },
  );

  app.post<{ Params: { documentId: string; proposalId: string }; Body: unknown }>(
    '/v1/sop-documents/:documentId/recovery-proposals/:proposalId/dismiss',
    async (request) => {
      parseDocumentId(request.params);
      const proposalId = parseProposalId(request.params);
      const body = resolveBodySchema.safeParse(request.body ?? {});

      if (!body.success) {
        throw badRequest('The note must be a short string.');
      }

      const result = await context.recoveryProposals.dismiss(proposalId as never, body.data.note);

      if (!result.ok) {
        throw result.reason === 'not_found' ? notFound(result.message) : conflict(result.message);
      }

      const payload: DataEnvelope<RecoveryProposalView> = {
        data: toRecoveryProposalView(result.proposal),
      };

      return payload;
    },
  );

  /**
   * The grant itself.
   *
   * Withdrawing it stops *future* versions declaring the capability and cannot
   * retract it from versions already published — those are immutable, and a
   * grant that could be revoked retroactively would mean a published version no
   * longer said what it does (ADR-005).
   */
  app.post<{ Params: { documentId: string }; Body: unknown }>(
    '/v1/sop-documents/:documentId/recovery',
    async (request) => {
      const documentId = parseDocumentId(request.params);
      const body = grantBodySchema.safeParse(request.body);

      if (!body.success) {
        throw badRequest('Send { "enabled": true } or { "enabled": false }.');
      }

      const existing = await context.recoveryProposals.isEnabled(documentId as never);

      if (existing === null) {
        throw notFound(`SOP document "${documentId}" does not exist.`);
      }

      const enabled = await context.recoveryProposals.setEnabled(
        documentId as never,
        body.data.enabled,
      );

      const payload: DataEnvelope<{ documentId: string; recoveryEnabled: boolean }> = {
        data: { documentId, recoveryEnabled: enabled },
      };

      return payload;
    },
  );
}
