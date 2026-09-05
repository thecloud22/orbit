import { pino } from 'pino';

import { describeWorker } from './worker-info';

/**
 * Orbit browser worker process.
 *
 * Phase 1 has no queue, scheduler, or long-lived worker loop (ADR-011), so this
 * module exists only to report the worker's identity. Actual execution is one
 * run per invocation through `pnpm agent:run`, which is `src/cli/run-agent.ts`.
 */
const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });
const worker = describeWorker();

logger.info(
  { worker: worker.name, ready: worker.ready },
  'Orbit browser worker. Execute a run with: pnpm agent:run -- --request-number SR-1001',
);
