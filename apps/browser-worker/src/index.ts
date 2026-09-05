import { pino } from 'pino';

import { describeWorker } from './worker-info';

/**
 * Orbit browser worker process.
 *
 * Task 1 scaffold: starts, logs its identity, and exits. It runs as a process
 * separate from the API because browser execution has distinct resource and
 * isolation needs. The runtime interpreter and Playwright executor arrive in
 * Task 6.
 */
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const worker = describeWorker();

logger.info(
  { worker: worker.name, ready: worker.ready },
  'Orbit browser worker scaffold started. Run execution is implemented in Task 6.',
);
