import { ZodError } from 'zod';
import Fastify, { type FastifyInstance } from 'fastify';

import type { ApiContext } from './context';
import { ApiError, internalError, toErrorEnvelope } from './errors';
import { registerAgentVersionRoutes } from './routes/agent-versions';
import { registerArtifactRoutes } from './routes/artifacts';
import { registerRunRoutes } from './routes/runs';
import { registerRecordingRoutes } from './routes/recording';
import { registerBindingSessionRoutes } from './routes/binding-sessions';
import { registerWalkthroughSessionRoutes } from './routes/walkthrough-sessions';
import { registerCandidateRoutes } from './routes/candidates';
import { registerPublishingRoutes } from './routes/publishing';
import { registerPublishRecordingRoutes } from './routes/publish-recording';
import { registerPublishBoundRoutes } from './routes/publish-bound';
import { registerRecoveryRoutes } from './routes/recovery';
import { registerSopBindingRoutes } from './routes/sop-bindings';
import { registerModelUsageRoutes } from './routes/model-usage';
import { registerPlatformRoutes } from './routes/platform';
import { registerSopDraftRoutes } from './routes/sop-drafts';
import { registerSopRevisionRoutes } from './routes/sop-revisions';

export interface BuildServerOptions {
  readonly context: ApiContext;
  /** Pino log level. Tests pass 'silent' to keep output readable. */
  readonly logLevel?: string;
}

/**
 * Builds the Orbit API server.
 *
 * Every route reaches the database, artifact storage, and the runtime only
 * through `ApiContext`, whose members are interfaces — which is what lets the
 * HTTP surface be tested against fakes with no PostgreSQL and no browser.
 */
export function buildServer(options: BuildServerOptions): FastifyInstance {
  const app = Fastify({
    logger: { level: options.logLevel ?? process.env['LOG_LEVEL'] ?? 'info' },
  });

  app.get('/health', () => ({ status: 'ok' as const }));

  registerAgentVersionRoutes(app, options.context);
  registerRunRoutes(app, options.context);
  registerCandidateRoutes(app, options.context);
  registerPublishRecordingRoutes(app, options.context);
  registerPublishBoundRoutes(app, options.context);
  registerPublishingRoutes(app, options.context);
  registerRecoveryRoutes(app, options.context);
  registerArtifactRoutes(app, options.context);
  registerSopDraftRoutes(app, options.context);
  registerModelUsageRoutes(app, options.context);
  registerPlatformRoutes(app, options.context);
  registerSopRevisionRoutes(app, options.context);
  registerSopBindingRoutes(app, options.context);
  registerRecordingRoutes(app, options.context);
  registerBindingSessionRoutes(app, options.context);
  registerWalkthroughSessionRoutes(app, options.context);

  app.setNotFoundHandler((_request, reply) => {
    const error = new ApiError({
      code: 'VALIDATION_ERROR',
      statusCode: 404,
      message: 'No such route.',
    });
    return reply.code(404).send(toErrorEnvelope(error));
  });

  /**
   * One place decides what a failure looks like on the wire.
   *
   * An unclassified failure becomes a generic 500: the real error is logged
   * server-side, never serialized. A database message or a stack trace in a
   * response body would hand a caller exactly the internal detail every other
   * part of this API is careful not to expose.
   */
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      if (error.statusCode >= 500) {
        request.log.error({ err: error, code: error.code }, 'Request failed.');
      } else {
        request.log.info({ code: error.code, statusCode: error.statusCode }, 'Request rejected.');
      }
      return reply.code(error.statusCode).send(toErrorEnvelope(error));
    }

    if (error instanceof ZodError) {
      const validation = new ApiError({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
        message: 'The request is not valid.',
        details: error.issues.map((issue) => ({
          field: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      });
      return reply.code(400).send(toErrorEnvelope(validation));
    }

    request.log.error({ err: error }, 'Unhandled request failure.');
    return reply
      .code(500)
      .send(toErrorEnvelope(internalError('The request could not be completed.')));
  });

  return app;
}
