import { agentVersionIdSchema, runTriggerSchema, type RunTrigger } from '@orbit/contracts';
import { isRuntimeError, prepareExecution } from '@orbit/runtime';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { ApiContext } from '../context';
import { badRequest, invalidInput, notFound } from '../errors';
import { toAgentVersionView } from '../projections';
import type { CreateRunResultView, DataEnvelope } from '../views';

/**
 * The Phase 1 development actor.
 *
 * Watchtower has no sign-in, but the actor is an explicit field rather than an
 * assumption, so real authentication replaces the stub without reshaping any
 * persisted run.
 */
const DEVELOPMENT_TRIGGER: RunTrigger = {
  type: 'watchtower_manual',
  actor: { type: 'development_user', id: 'dev-user' },
  source: { application: 'orbit-watchtower' },
};

const createRunBodySchema = z.strictObject({
  /**
   * Values are `unknown` on purpose: type and length rules belong to the Agent
   * Version's own input declarations, and `prepareExecution` is the single
   * validator that applies them for both this API and the CLI.
   */
  inputs: z.record(z.string().min(1), z.unknown()),
  trigger: runTriggerSchema.optional(),
});

export function registerAgentVersionRoutes(app: FastifyInstance, context: ApiContext): void {
  app.get('/v1/agent-versions', async () => {
    const versions = await context.repositories.agentVersions.listPublished();
    return { data: versions.map(toAgentVersionView) };
  });

  app.post('/v1/agent-versions/:agentVersionId/runs', async (request, reply) => {
    const agentVersionId = parseAgentVersionId(request.params);
    const body = createRunBodySchema.safeParse(request.body ?? {});

    if (!body.success) {
      throw badRequest(
        'The request body is not a valid run request.',
        body.error.issues.map((issue) => ({
          field: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }

    const agentVersion = await context.repositories.agentVersions.findById(agentVersionId);

    if (agentVersion === null) {
      throw notFound(`Agent Version "${agentVersionId}" does not exist.`);
    }

    // Checked on the record as well as on the IR below. The two cannot disagree
    // for a version this repository wrote — the column is derived from the IR
    // and both are immutable — but only one of them is what `GET
    // /v1/agent-versions` publishes, so both are enforced rather than assumed
    // consistent.
    if (agentVersion.lifecycleStatus !== 'published') {
      throw badRequest(
        `Agent Version "${agentVersionId}" is ${agentVersion.lifecycleStatus}; only a published version may be run.`,
      );
    }

    // The same gate the CLI applies: published, executable by this runtime, and
    // inputs that satisfy the version's own declarations. A refusal here means
    // no run row is created, which is what makes a rejected request leave no
    // trace in the evidence tables.
    let prepared;
    try {
      prepared = prepareExecution({
        agentVersionId,
        agentIr: agentVersion.agentIr,
        rawInputs: body.data.inputs,
      });
    } catch (error) {
      if (isRuntimeError(error)) {
        throw error.code === 'INPUT_ERROR'
          ? invalidInput(error.message, error.details)
          : badRequest(error.message, error.details);
      }
      throw error;
    }

    const { runId } = await context.dispatcher.dispatch({
      agentVersionId,
      agentIr: prepared.agentIr,
      inputs: prepared.inputs,
      trigger: body.data.trigger ?? DEVELOPMENT_TRIGGER,
    });

    // 202: the run exists and is durable, and execution continues after this
    // response is sent (ADR-011). Watchtower polls the run for its real state.
    const payload: DataEnvelope<CreateRunResultView> = {
      data: {
        runId,
        status: 'queued',
        businessOutcome: 'none',
        agentVersionId,
        createdAt: new Date().toISOString(),
      },
    };

    return reply.code(202).send(payload);
  });
}

function parseAgentVersionId(params: unknown) {
  const parsed = z.object({ agentVersionId: agentVersionIdSchema }).safeParse(params);

  if (!parsed.success) {
    throw badRequest('The agent version id is not a valid Orbit identifier.');
  }

  return parsed.data.agentVersionId;
}
