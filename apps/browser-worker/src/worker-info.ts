export const WORKER_NAME = 'orbit-browser-worker' as const;

export interface WorkerInfo {
  readonly name: string;
  /** True once the runtime interpreter and Playwright executor are wired up. */
  readonly ready: boolean;
}

export function describeWorker(): WorkerInfo {
  return { name: WORKER_NAME, ready: true };
}
