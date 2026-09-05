import Fastify, { type FastifyInstance } from 'fastify';

export interface BuildServerOptions {
  /** Pino log level. Tests pass 'silent' to keep output readable. */
  readonly logLevel?: string;
}

/**
 * Builds the Orbit API server.
 *
 * Task 1 scaffold: exposes only a liveness probe so the process can be proven
 * to boot. The Phase 1 business routes (GET /v1/agent-versions,
 * POST /v1/agent-versions/:id/runs, GET /v1/runs/:runId) arrive in Task 7.
 */
export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: { level: options.logLevel ?? process.env.LOG_LEVEL ?? 'info' },
  });

  app.get('/health', () => ({ status: 'ok' as const }));

  return app;
}
