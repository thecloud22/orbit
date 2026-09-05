import { eventEnvelopeSchema, type ArtifactId, type EventEnvelope } from '@orbit/contracts';

import { DatabaseIntegrityError } from '../errors';
import type { RunEventRow } from '../schema';

/**
 * Rebuilds the event envelope defined in the events-and-evidence contract.
 *
 * `artifactRefs` is not stored on the event row: it is assembled from the
 * artifact links that target this event, so a reference can never point at an
 * artifact that does not exist. `occurredAt` is serialized as an ISO string
 * because the envelope is what the API and Watchtower consume.
 *
 * The persisted `attempt` column has no place in the envelope contract and is
 * therefore not returned here; it stays on the row for the retry design that
 * will need it.
 */
export function toEventEnvelope(
  row: RunEventRow,
  artifactRefs: readonly ArtifactId[],
): EventEnvelope {
  const envelope = {
    id: row.id,
    schemaVersion: row.schemaVersion,
    runId: row.runId,
    ...(row.runStepId === null ? {} : { runStepId: row.runStepId }),
    agentVersionId: row.agentVersionId,
    ...(row.agentStepId === null ? {} : { agentStepId: row.agentStepId }),
    eventType: row.eventType,
    occurredAt: row.occurredAt.toISOString(),
    sequence: row.sequence,
    payload: row.payload,
    artifactRefs: [...artifactRefs],
  };

  const parsed = eventEnvelopeSchema.safeParse(envelope);

  if (!parsed.success) {
    throw new DatabaseIntegrityError(
      `run_events row ${row.id} does not satisfy the event envelope contract: ${JSON.stringify(parsed.error.issues)}`,
    );
  }

  return parsed.data;
}
