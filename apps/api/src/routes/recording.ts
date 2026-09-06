import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { ApiContext } from '../context';
import { ApiError, badRequest, notFound } from '../errors';
import type { DataEnvelope } from '../views';
import type { RecordingSessionState } from '../recording/session-registry';

/**
 * Recording a workflow from Watchtower.
 *
 * The start/poll/finish shape mirrors run dispatch (ADR-011) for the same
 * reason: a recording takes as long as a person takes, which is far longer than
 * an HTTP request should live. Starting returns an id, polling reports what has
 * happened since, and finishing compiles the sequence into a document.
 *
 * The browser opens on the machine running the API, because someone has to see
 * and click it. That is a real constraint on where Orbit can run rather than an
 * implementation detail, and the UI says so plainly.
 */

const startBodySchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  startUrl: z.string().trim().min(1).max(2000),
});

const sessionIdSchema = z.string().regex(/^rec_[A-Za-z0-9]+$/);

/**
 * Recording performs real actions, so the target is checked before a browser
 * opens — the runtime's own allowlist, not a second copy of it.
 */
const ALLOWED_RECORDING_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'] as const;

function assertSandbox(candidate: string): string {
  let url: URL;

  try {
    url = new URL(candidate);
  } catch {
    throw badRequest(`"${candidate}" is not a URL.`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw badRequest(`${url.protocol} is not a protocol Orbit will open.`);
  }

  if (!(ALLOWED_RECORDING_HOSTS as readonly string[]).includes(url.hostname)) {
    throw badRequest(
      'Recording performs real actions in a real browser, so it may only ever target a local ' +
        `sandbox. "${url.hostname}" is not one of ${ALLOWED_RECORDING_HOSTS.join(', ')}.`,
    );
  }

  return url.toString();
}

function parseSessionId(params: unknown): string {
  const parsed = z.object({ sessionId: sessionIdSchema }).safeParse(params);

  if (!parsed.success) {
    throw badRequest('That is not a recording session id.');
  }

  return parsed.data.sessionId;
}

export function registerRecordingRoutes(app: FastifyInstance, context: ApiContext): void {
  app.post('/v1/recording-sessions', async (request, reply) => {
    const body = startBodySchema.safeParse(request.body ?? {});

    if (!body.success) {
      throw badRequest(
        'A recording needs a title and a starting URL.',
        body.error.issues.map((issue) => ({
          field: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }

    const startUrl = assertSandbox(body.data.startUrl);

    const state = await context.recordingSessions.start({ title: body.data.title, startUrl });

    const payload: DataEnvelope<RecordingSessionState> = { data: state };
    return reply.code(201).send(payload);
  });

  app.get<{ Params: { sessionId: string } }>(
    '/v1/recording-sessions/:sessionId',
    async (request) => {
      const sessionId = parseSessionId(request.params);
      const state = context.recordingSessions.get(sessionId);

      if (state === null) {
        throw notFound('That recording session is not open.');
      }

      const payload: DataEnvelope<RecordingSessionState> = { data: state };
      return payload;
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    '/v1/recording-sessions/:sessionId/finish',
    async (request, reply) => {
      const sessionId = parseSessionId(request.params);
      const result = await context.recordingSessions.finish(sessionId);

      if (!result.ok) {
        if (result.reason === 'not_found') {
          throw notFound('That recording session is not open.');
        }

        if (result.reason === 'nothing_recorded') {
          throw badRequest('Nothing was recorded, so there is no workflow to save.');
        }

        // The session stays open: the browser still holds work the person
        // cannot repeat, and closing it would throw that away.
        throw new ApiError({
          code: 'VALIDATION_ERROR',
          statusCode: 422,
          message:
            'That recording could not become a workflow. The session is still open, so nothing was lost.',
          details: result.issues.map((issue) => ({
            field: issue.path.length > 0 ? issue.path.join('.') : 'graph',
            message: `[${issue.code}] ${issue.message}`,
          })),
        });
      }

      return reply.code(201).send({
        data: {
          documentId: result.documentId,
          stepCount: result.stepCount,
          bindingCount: result.bindingCount,
        },
      });
    },
  );

  app.delete<{ Params: { sessionId: string } }>(
    '/v1/recording-sessions/:sessionId',
    async (request, reply) => {
      const sessionId = parseSessionId(request.params);
      const cancelled = await context.recordingSessions.cancel(sessionId);

      if (!cancelled) {
        throw notFound('That recording session is not open.');
      }

      return reply.code(204).send();
    },
  );
}
