import {
  orbitErrorSchema,
  runStepStatusSchema,
  type OrbitError,
  type RunId,
  type RunStepId,
  type RunStepStatus,
} from '@orbit/contracts';

import type { RunStepRow } from '../schema';
import { decode } from './run';

export interface RunStepRecord {
  readonly id: RunStepId;
  readonly runId: RunId;
  readonly agentStepId: string;
  readonly stepType: string;
  readonly sequence: number;
  readonly attempt: number;
  readonly status: RunStepStatus;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly output: Record<string, unknown> | null;
  readonly error: OrbitError | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function toRunStepRecord(row: RunStepRow): RunStepRecord {
  return {
    id: row.id,
    runId: row.runId,
    agentStepId: row.agentStepId,
    stepType: row.stepType,
    sequence: row.sequence,
    attempt: row.attempt,
    status: decode(runStepStatusSchema, row.status, `run_steps.status for ${row.id}`),
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    output: row.output,
    error:
      row.error === null
        ? null
        : decode(orbitErrorSchema, row.error, `run_steps.error for ${row.id}`),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
