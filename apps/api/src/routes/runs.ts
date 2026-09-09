import { runIdSchema, type RunId } from '@orbit/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { ApiContext } from '../app/context';
import { badRequest, notFound } from '../errors';
import {
  toRunDetailView,
  toRunEventView,
  toRunListItemView,
  toRunSummaryView,
} from '../views/projections';

/**
 * Read-only run access.
 *
 * Everything here answers from persisted state. Watchtower must never conclude a
 * run succeeded because an HTTP call returned 202 — the only source of a run's
 * status is the run row these routes read.
 */
export function registerRunRoutes(app: FastifyInstance, context: ApiContext): void {
  /**
   * Every run, across every agent, newest first.
   *
   * Phase 1 deliberately had no run history at all — a run was reopened by id
   * and nothing else. A Runs page needs a starting point to reopen anything
   * from, so this is that: read-only, and bounded, since nothing here paginates
   * yet.
   */
  app.get('/v1/runs', async (request) => {
    const query = z
      .object({ limit: z.coerce.number().int().positive().max(200).optional() })
      .safeParse(request.query ?? {});

    if (!query.success) {
      throw badRequest('limit must be a positive integer, at most 200.');
    }

    const runs = await context.repositories.runs.listRecent({ limit: query.data.limit ?? 50 });

    // One extra read per run rather than a join, because @orbit/db keeps
    // reads simple and this list is small at Phase 1 scale.
    const items = await Promise.all(
      runs.map(async (run) => {
        const agentVersion = await context.repositories.agentVersions.findById(run.agentVersionId);

        return toRunListItemView(run, agentVersion ?? { name: 'Unknown agent', version: '' });
      }),
    );

    return { data: items };
  });

  app.get('/v1/runs/:runId', async (request) => {
    const runId = parseRunId(request.params);
    const run = await loadRun(context, runId);

    const agentVersion = await context.repositories.agentVersions.findById(run.agentVersionId);

    if (agentVersion === null) {
      // Restricted foreign keys make this unreachable; checked rather than
      // assumed, because rendering a run without the version it pinned would
      // misrepresent what was executed.
      throw notFound(`Run "${runId}" references an Agent Version that no longer exists.`);
    }

    const [steps, events, artifacts] = await Promise.all([
      context.repositories.runSteps.listByRun(runId),
      context.repositories.runEvents.listByRun(runId),
      context.repositories.artifacts.listByRun(runId),
    ]);

    const withLinks = await Promise.all(
      artifacts.map(async (artifact) => ({
        artifact,
        links: await context.repositories.artifacts.listLinksForArtifact(artifact.id),
      })),
    );

    return { data: toRunDetailView({ run, agentVersion, steps, events, artifacts: withLinks }) };
  });

  /** The lighter poll: ordered events only, optionally just the new ones. */
  app.get('/v1/runs/:runId/events', async (request) => {
    const runId = parseRunId(request.params);
    await loadRun(context, runId);

    const query = z
      .object({ afterSequence: z.coerce.number().int().nonnegative().optional() })
      .safeParse(request.query ?? {});

    if (!query.success) {
      throw badRequest('afterSequence must be a non-negative integer.');
    }

    const after = query.data.afterSequence;
    const events =
      after === undefined
        ? await context.repositories.runEvents.listByRun(runId)
        : await context.repositories.runEvents.listByRunSince(runId, after);

    return { data: events.map(toRunEventView) };
  });

  /** The status poll, without the timeline payloads. */
  app.get('/v1/runs/:runId/summary', async (request) => {
    const runId = parseRunId(request.params);
    return { data: toRunSummaryView(await loadRun(context, runId)) };
  });
}

async function loadRun(context: ApiContext, runId: RunId) {
  const run = await context.repositories.runs.findById(runId);

  if (run === null) {
    throw notFound(`Run "${runId}" does not exist.`);
  }

  return run;
}

export function parseRunId(params: unknown): RunId {
  const parsed = z.object({ runId: runIdSchema }).safeParse(params);

  if (!parsed.success) {
    throw badRequest('The run id is not a valid Orbit identifier.');
  }

  return parsed.data.runId;
}
