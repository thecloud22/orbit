export const WORKER_NAME = 'orbit-browser-worker' as const;

export interface WorkerInfo {
  readonly name: string;
  /** False until the runtime interpreter and Playwright executor land in Task 6. */
  readonly ready: boolean;
}

export function describeWorker(): WorkerInfo {
  return { name: WORKER_NAME, ready: false };
}
