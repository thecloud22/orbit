import {
  businessOutcomeSchema,
  orbitErrorSchema,
  runInputsSchema,
  runOutputsSchema,
  runStatusSchema,
  runTriggerSchema,
  type AgentVersionId,
  type BusinessOutcome,
  type OrbitError,
  type RunId,
  type RunInputs,
  type RunOutputs,
  type RunStatus,
  type RunTrigger,
} from '@orbit/contracts';
import type { z } from 'zod';

import { DatabaseIntegrityError } from '../errors';
import type { RunRow } from '../schema';

export interface RunRecord {
  readonly id: RunId;
  readonly agentVersionId: AgentVersionId;
  readonly status: RunStatus;
  readonly businessOutcome: BusinessOutcome;
  readonly trigger: RunTrigger;
  readonly inputs: RunInputs;
  readonly outputs: RunOutputs | null;
  readonly error: OrbitError | null;
  readonly queuedAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Validates a JSONB column against its contract on the way out.
 *
 * JSONB is schemaless to PostgreSQL, so the contract is only real if it is
 * checked at the boundary. A column that no longer matches raises rather than
 * flowing on as a mistyped value.
 */
function decode<T extends z.ZodType>(schema: T, value: unknown, context: string): z.output<T> {
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    throw new DatabaseIntegrityError(
      `${context} does not satisfy its contract: ${JSON.stringify(parsed.error.issues)}`,
    );
  }

  return parsed.data;
}

export function toRunRecord(row: RunRow): RunRecord {
  return {
    id: row.id,
    agentVersionId: row.agentVersionId,
    status: decode(runStatusSchema, row.status, `runs.status for ${row.id}`),
    businessOutcome: decode(
      businessOutcomeSchema,
      row.businessOutcome,
      `runs.business_outcome for ${row.id}`,
    ),
    trigger: decode(runTriggerSchema, row.trigger, `runs.trigger for ${row.id}`),
    inputs: decode(runInputsSchema, row.inputs, `runs.inputs for ${row.id}`),
    outputs:
      row.outputs === null
        ? null
        : decode(runOutputsSchema, row.outputs, `runs.outputs for ${row.id}`),
    error:
      row.error === null ? null : decode(orbitErrorSchema, row.error, `runs.error for ${row.id}`),
    queuedAt: row.queuedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export { decode };
