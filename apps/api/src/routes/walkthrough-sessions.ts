import { sopDocumentIdSchema } from '@orbit/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { ApiContext } from '../app/context';
import { ApiError, badRequest, notFound } from '../errors';
import { toWalkthroughSessionView } from '../views/projections';
import type { DataEnvelope, WalkthroughSessionView } from '../views/views';
import { assertOpenableTarget } from './browser-target';

/**
 * Binding a whole workflow from one walkthrough (ADR-035).
 *
 * The shape is `binding-sessions.ts`'s — start, poll, act — because the same
 * thing is true of both: a person takes far longer than an HTTP request should
 * live. What differs is the ending. There is no `save` here, and there will not
 * be one: this route cannot create a binding. `POST .../proposals` writes
 * *proposals*, which are rows a person then accepts through the existing
 * proposal routes, so there is still exactly one code path by which a mapping
 * becomes live.
 *
 * The other difference is the mode switch. A walkthrough is performed in
 * `action` mode, because the person is doing the real task and the page must
 * react as it would for them. Reading a value is the exception — pointing at
 * something must not fire the page's handlers — so it is an explicit switch
 * rather than something inferred from what they clicked.
 */

const startBodySchema = z.strictObject({
  documentId: sopDocumentIdSchema,
  startUrl: z.string().trim().min(1).max(2000),
});

const modeBodySchema = z.strictObject({ mode: z.enum(['action', 'pick']) });

const sessionIdSchema = z.string().regex(/^walk_[A-Za-z0-9]+$/);

function parseSessionId(params: unknown): string {
  const parsed = z.object({ sessionId: sessionIdSchema }).safeParse(params);

  if (!parsed.success) {
    throw badRequest('That is not a walkthrough session id.');
  }

  return parsed.data.sessionId;
}

/** 410: the session was real and its window is gone, which is precisely "gone". */
function browserClosed(): ApiError {
  return new ApiError({
    code: 'VALIDATION_ERROR',
    statusCode: 410,
    message:
      'The walkthrough browser was closed. Finish the walkthrough to see what Orbit made of ' +
      'what you did before it closed, or start a new one.',
  });
}

const NOTHING_TO_BIND =
  'Every step of this workflow that needs a binding already has one, so a walkthrough would ' +
  'change nothing. Re-demonstrate a single step instead if one is wrong.';

export function registerWalkthroughSessionRoutes(app: FastifyInstance, context: ApiContext): void {
  app.post('/v1/walkthrough-sessions', async (request, reply) => {
    const body = startBodySchema.safeParse(request.body ?? {});

    if (!body.success) {
      throw badRequest(
        'A walkthrough needs a workflow and a starting URL.',
        body.error.issues.map((issue) => ({
          field: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }

    // Checked before anything could open a browser.
    const startUrl = assertOpenableTarget(body.data.startUrl);

    const result = await context.walkthroughSessions.start({
      documentId: body.data.documentId,
      startUrl,
    });

    if (!result.ok) {
      switch (result.reason) {
        case 'document_not_found':
          throw notFound(`SOP document "${body.data.documentId}" does not exist.`);
        case 'nothing_to_bind':
          throw badRequest(NOTHING_TO_BIND);
        case 'session_exists':
          // 409 rather than silently reusing it: two browsers open on one
          // workflow would race each other's captures with no way to tell which
          // window a person was looking at. A typed error rather than a bare
          // `{data: {sessionId}}` body -- the latter has no `error` envelope
          // for a caller's typed-error parser to find, so the session id it
          // carried was silently lost on every prior refusal.
          throw new ApiError({
            code: 'SESSION_ALREADY_OPEN',
            statusCode: 409,
            message: 'A walkthrough session is already open for this workflow.',
            details: [{ field: 'sessionId', message: result.sessionId }],
          });
      }
    }

    const payload: DataEnvelope<WalkthroughSessionView> = {
      data: toWalkthroughSessionView(result.state),
    };

    return reply.code(201).send(payload);
  });

  app.get<{ Params: { sessionId: string } }>(
    '/v1/walkthrough-sessions/:sessionId',
    async (request) => {
      const sessionId = parseSessionId(request.params);
      const state = await context.walkthroughSessions.get(sessionId);

      if (state === null) {
        throw notFound('That walkthrough is not open.');
      }

      const payload: DataEnvelope<WalkthroughSessionView> = {
        data: toWalkthroughSessionView(state),
      };

      return payload;
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    '/v1/walkthrough-sessions/:sessionId/mode',
    async (request) => {
      const sessionId = parseSessionId(request.params);
      const body = modeBodySchema.safeParse(request.body ?? {});

      if (!body.success) {
        throw badRequest(
          'Switching what the walkthrough is capturing needs a mode: "action" or "pick".',
        );
      }

      const result = await context.walkthroughSessions.setMode(sessionId, body.data.mode);

      if (!result.ok) {
        switch (result.reason) {
          case 'not_found':
            throw notFound('That walkthrough is not open.');
          case 'browser_closed':
            throw browserClosed();
          case 'already_proposed':
            throw badRequest('This walkthrough has already been finished.');
        }
      }

      const payload: DataEnvelope<WalkthroughSessionView> = {
        data: toWalkthroughSessionView(result.state),
      };

      return payload;
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    '/v1/walkthrough-sessions/:sessionId/proposals',
    async (request, reply) => {
      const sessionId = parseSessionId(request.params);
      const result = await context.walkthroughSessions.propose(sessionId);

      if (!result.ok) {
        switch (result.reason) {
          case 'not_found':
            throw notFound('That walkthrough is not open.');
          case 'document_not_found':
            throw notFound('That workflow no longer exists.');
          case 'nothing_to_bind':
            throw badRequest(NOTHING_TO_BIND);
          case 'nothing_demonstrated':
            // 422 rather than 400: the request was well formed and the browser
            // is still open, so the answer is "do the task, then finish".
            throw new ApiError({
              code: 'VALIDATION_ERROR',
              statusCode: 422,
              message:
                'Nothing was demonstrated in this walkthrough — only pages were opened. Perform ' +
                'the task in the browser Orbit opened, then finish.',
            });
        }
      }

      const payload: DataEnvelope<WalkthroughSessionView> = {
        data: toWalkthroughSessionView(result.state),
      };

      return reply.code(201).send(payload);
    },
  );

  app.delete<{ Params: { sessionId: string } }>(
    '/v1/walkthrough-sessions/:sessionId',
    async (request, reply) => {
      const sessionId = parseSessionId(request.params);
      const cancelled = await context.walkthroughSessions.cancel(sessionId);

      if (!cancelled) {
        throw notFound('That walkthrough is not open.');
      }

      return reply.code(204).send();
    },
  );
}
