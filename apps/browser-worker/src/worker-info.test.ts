import { describe, expect, it } from 'vitest';

import { describeWorker, WORKER_NAME } from './worker-info';

describe('Orbit browser worker', () => {
  it('identifies itself and reports that execution is not implemented yet', () => {
    const worker = describeWorker();

    expect(worker.name).toBe(WORKER_NAME);
    expect(worker.ready).toBe(false);
  });
});
