import { sopDocumentIdSchema } from '@orbit/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { ApiContext } from '../app/context';
import { ApiError, badRequest, notFound } from '../errors';
import { toBindingSessionView, toSavedBindingView } from '../views/projections';
import type { BindingSessionView, DataEnvelope, SavedBindingView } from '../views/views';
import { assertOpenableTarget } from './browser-target';

/**
 * Binding one step of a workflow to a real page, from Watchtower.
 *
 * The write path `sop-bindings.ts` deliberately does not have. Keeping it in a
 * separate file is the point: that route's read-only-ness is a property of its
 * source rather than a promise about it, and it stays that way.
 *
 * The start/poll/save shape mirrors recording (ADR-020) for the same reason — a
 * person takes far longer than an HTTP request should live — with one
 * deliberate divergence: saving a binding does **not** close the session.
 * Mapping a workflow means binding several steps in sequence, and each starts
 * wherever the last left the page; reopening a blank page every time would put
 * anything past a sign-in out of reach.
 *
 * Only the steps the compiler requires a binding for can be targeted:
 * `fill`, `click`, `extract` and `decision`. A decision is the one that takes
 * several sittings at this route — one capture per branch, each posted with the
 * branch it demonstrates, and the binding row written only when the set is
 * complete. Until then the response carries a null `bindingId`, because nothing
 * has been written.
 */

const startBodySchema = z.strictObject({
  documentId: sopDocumentIdSchema,
  stepId: z.string().trim().min(1).max(200),
  startUrl: z.string().trim().min(1).max(2000),
});

const targetBodySchema = z.strictObject({
  stepId: z.string().trim().min(1).max(200),
});

const valueSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('sop_variable'),
    name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  }),
  z.strictObject({ kind: z.literal('literal'), value: z.string().max(2000) }),
]);

const readMethodSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text') }),
  z.strictObject({ kind: z.literal('attribute'), attribute: z.string().min(1).max(200) }),
  z.strictObject({ kind: z.literal('checked') }),
]);

const bindBodySchema = z.strictObject({
  captureId: z.string().trim().min(1).max(200),
  valueSource: valueSourceSchema.optional(),
  readMethod: readMethodSchema.optional(),
  variable: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/)
    .optional(),
  /** For a decision: the branch this capture demonstrates, in the graph's words. */
  branchWhen: z.string().trim().min(1).max(500).optional(),
});

const sessionIdSchema = z.string().regex(/^bind_[A-Za-z0-9]+$/);

function parseSessionId(params: unknown): string {
  const parsed = z.object({ sessionId: sessionIdSchema }).safeParse(params);

  if (!parsed.success) {
    throw badRequest('That is not a binding session id.');
  }

  return parsed.data.sessionId;
}

function notBindable(stepId: string): ApiError {
  return badRequest(
    `Step "${stepId}" is not a step a binding session can map: only filling a field, clicking ` +
      'something, reading a value and choosing between branches are performed in a browser.',
  );
}

function unknownStep(stepId: string): ApiError {
  return notFound(`This workflow has no step "${stepId}".`);
}

export function registerBindingSessionRoutes(app: FastifyInstance, context: ApiContext): void {
  app.post('/v1/binding-sessions', async (request, reply) => {
    const body = startBodySchema.safeParse(request.body ?? {});

    if (!body.success) {
      throw badRequest(
        'Binding a step needs a workflow, a step and a starting URL.',
        body.error.issues.map((issue) => ({
          field: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      );
    }

    // Checked before anything could open a browser.
    const startUrl = assertOpenableTarget(body.data.startUrl);

    const result = await context.bindingSessions.start({
      documentId: body.data.documentId,
      stepId: body.data.stepId,
      startUrl,
    });

    if (!result.ok) {
      switch (result.reason) {
        case 'document_not_found':
          throw notFound(`SOP document "${body.data.documentId}" does not exist.`);
        case 'unknown_step':
          throw unknownStep(result.stepId);
        case 'not_bindable':
          throw notBindable(result.stepId);
        case 'session_exists':
          // 409 rather than silently reusing it: two browsers open on one
          // workflow would race each other's captures with no way to tell
          // which window a person was looking at. A typed error rather than a
          // bare `{data: {sessionId}}` body -- the latter has no `error`
          // envelope for a caller's typed-error parser to find, so the
          // session id it carried was silently lost on every prior refusal.
          throw new ApiError({
            code: 'SESSION_ALREADY_OPEN',
            statusCode: 409,
            message: 'A binding session is already open for this workflow.',
            details: [{ field: 'sessionId', message: result.sessionId }],
          });
      }
    }

    const payload: DataEnvelope<BindingSessionView> = { data: toBindingSessionView(result.state) };
    return reply.code(201).send(payload);
  });

  app.get<{ Params: { sessionId: string } }>('/v1/binding-sessions/:sessionId', async (request) => {
    const sessionId = parseSessionId(request.params);
    const state = context.bindingSessions.get(sessionId);

    if (state === null) {
      throw notFound('That binding session is not open.');
    }

    const payload: DataEnvelope<BindingSessionView> = { data: toBindingSessionView(state) };
    return payload;
  });

  app.post<{ Params: { sessionId: string } }>(
    '/v1/binding-sessions/:sessionId/target',
    async (request) => {
      const sessionId = parseSessionId(request.params);
      const body = targetBodySchema.safeParse(request.body ?? {});

      if (!body.success) {
        throw badRequest('Switching steps needs a step id.');
      }

      const result = await context.bindingSessions.target(sessionId, body.data.stepId);

      if (!result.ok) {
        switch (result.reason) {
          case 'not_found':
            throw notFound('That binding session is not open.');
          case 'browser_closed':
            // 410 rather than 404 or 409: the session existed and its window
            // is gone, which is precisely "gone". 409 is already taken here by
            // "a session is still open for this workflow" -- the opposite
            // problem, and the UI words them differently.
            throw new ApiError({
              code: 'VALIDATION_ERROR',
              statusCode: 410,
              message:
                'The recording browser was closed, so this session cannot continue. ' +
                'Start binding again to open a new one.',
            });
          case 'document_not_found':
            throw notFound('That workflow no longer exists.');
          case 'unknown_step':
            throw unknownStep(result.stepId);
          case 'not_bindable':
            throw notBindable(result.stepId);
        }
      }

      const payload: DataEnvelope<BindingSessionView> = {
        data: toBindingSessionView(result.state),
      };
      return payload;
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    '/v1/binding-sessions/:sessionId/binding',
    async (request, reply) => {
      const sessionId = parseSessionId(request.params);
      const body = bindBodySchema.safeParse(request.body ?? {});

      if (!body.success) {
        throw badRequest(
          'Saving a binding needs the capture it was demonstrated with.',
          body.error.issues.map((issue) => ({
            field: issue.path.join('.') || 'body',
            message: issue.message,
          })),
        );
      }

      const result = await context.bindingSessions.bind(sessionId, {
        captureId: body.data.captureId,
        ...(body.data.valueSource === undefined ? {} : { valueSource: body.data.valueSource }),
        ...(body.data.readMethod === undefined ? {} : { readMethod: body.data.readMethod }),
        ...(body.data.variable === undefined ? {} : { variable: body.data.variable }),
        ...(body.data.branchWhen === undefined ? {} : { branchWhen: body.data.branchWhen }),
      });

      if (!result.ok) {
        switch (result.reason) {
          case 'not_found':
            throw notFound('That binding session is not open.');
          case 'browser_closed':
            // 410 rather than 404 or 409: the session existed and its window
            // is gone, which is precisely "gone". 409 is already taken here by
            // "a session is still open for this workflow" -- the opposite
            // problem, and the UI words them differently.
            throw new ApiError({
              code: 'VALIDATION_ERROR',
              statusCode: 410,
              message:
                'The recording browser was closed, so this session cannot continue. ' +
                'Start binding again to open a new one.',
            });
          case 'document_not_found':
            throw notFound('That workflow no longer exists.');
          case 'unknown_step':
            throw unknownStep(result.stepId);
          case 'not_bindable':
            throw notBindable(result.stepId);
          case 'unknown_capture':
            throw badRequest('That capture is not one this session recorded.');
          case 'refused':
            throw new ApiError({
              code: 'VALIDATION_ERROR',
              statusCode: 422,
              message: result.message,
            });
          case 'invalid':
            // The session stays open: the browser still holds the page the
            // person demonstrated on, and closing it would make them repeat
            // work to fix something they can fix in place.
            throw new ApiError({
              code: 'VALIDATION_ERROR',
              statusCode: 422,
              message: 'That binding was refused. The session is still open, so nothing was lost.',
              details: result.issues.map((issue) => ({
                field: issue.path.length > 0 ? issue.path.join('.') : 'binding',
                message: `[${issue.code}] ${issue.message}`,
              })),
            });
        }
      }

      const payload: DataEnvelope<SavedBindingView> = {
        data: toSavedBindingView({ binding: result.binding, state: result.state }),
      };

      return reply.code(201).send(payload);
    },
  );

  app.delete<{ Params: { sessionId: string } }>(
    '/v1/binding-sessions/:sessionId',
    async (request, reply) => {
      const sessionId = parseSessionId(request.params);
      const cancelled = await context.bindingSessions.cancel(sessionId);

      if (!cancelled) {
        throw notFound('That binding session is not open.');
      }

      return reply.code(204).send();
    },
  );
}
