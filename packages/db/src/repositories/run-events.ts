import {
  newEventId,
  type AgentVersionId,
  type ArtifactId,
  type EventEnvelope,
  type EventId,
  type EventType,
  type RunId,
  type RunStepId,
} from '@orbit/contracts';
import { asc, eq, gt, and, inArray, isNotNull } from 'drizzle-orm';

import type { Executor } from '../client';
import { toEventEnvelope } from '../mappers';
import { artifactLinks, runEvents, type RunEventRow } from '../schema';
import { allocateEventSequence } from './sequences';

export interface AppendEventInput {
  readonly runId: RunId;
  readonly agentVersionId: AgentVersionId;
  readonly eventType: EventType;
  /** Safe structured detail. Never secrets, credentials, or raw page content. */
  readonly payload?: Record<string, unknown>;
  readonly runStepId?: RunStepId;
  readonly agentStepId?: string;
  readonly attempt?: number;
  readonly occurredAt?: Date;
  readonly schemaVersion?: string;
  readonly id?: EventId;
}

/**
 * Run events are append-only.
 *
 * This interface has no update or delete method, and that is the enforcement:
 * an event log that can be rewritten proves nothing about what happened.
 * Database-level enforcement is deferred to production hardening (ADR-014).
 */
export interface RunEventRepository {
  /** Allocates the strict per-run sequence and appends the event. */
  append(input: AppendEventInput): Promise<EventEnvelope>;
  /** Ordered by sequence, never by timestamp. */
  listByRun(runId: RunId): Promise<readonly EventEnvelope[]>;
  /** The polling/live-update read: everything after a sequence the caller already has. */
  listByRunSince(runId: RunId, afterSequence: number): Promise<readonly EventEnvelope[]>;
  findById(id: EventId): Promise<EventEnvelope | null>;
}

export function createRunEventRepository(executor: Executor): RunEventRepository {
  /**
   * Assembles `artifactRefs` from the links that target each event, so an event
   * can only reference artifacts that actually exist.
   */
  async function withArtifactRefs(rows: readonly RunEventRow[]): Promise<EventEnvelope[]> {
    if (rows.length === 0) {
      return [];
    }

    const links = await executor
      .select({ eventId: artifactLinks.runEventId, artifactId: artifactLinks.artifactId })
      .from(artifactLinks)
      .where(
        and(
          isNotNull(artifactLinks.runEventId),
          inArray(
            artifactLinks.runEventId,
            rows.map((row) => row.id),
          ),
        ),
      )
      .orderBy(asc(artifactLinks.createdAt), asc(artifactLinks.id));

    const refsByEvent = new Map<EventId, ArtifactId[]>();

    for (const link of links) {
      if (link.eventId === null) {
        continue;
      }
      const existing = refsByEvent.get(link.eventId);
      if (existing === undefined) {
        refsByEvent.set(link.eventId, [link.artifactId]);
      } else {
        existing.push(link.artifactId);
      }
    }

    return rows.map((row) => toEventEnvelope(row, refsByEvent.get(row.id) ?? []));
  }

  return {
    async append(input) {
      // Allocation and insert share one transaction, so a failed insert cannot
      // burn a sequence number and leave a hole in the event log. Called inside
      // a caller's transaction this nests as a savepoint rather than a second
      // top-level transaction.
      return executor.transaction(async (tx) => {
        const sequence = await allocateEventSequence(tx, input.runId);

        const [row] = await tx
          .insert(runEvents)
          .values({
            id: input.id ?? newEventId(),
            runId: input.runId,
            agentVersionId: input.agentVersionId,
            eventType: input.eventType,
            sequence,
            occurredAt: input.occurredAt ?? new Date(),
            payload: input.payload ?? {},
            runStepId: input.runStepId ?? null,
            agentStepId: input.agentStepId ?? null,
            attempt: input.attempt ?? null,
            ...(input.schemaVersion === undefined ? {} : { schemaVersion: input.schemaVersion }),
          })
          .returning();

        // A just-appended event has no artifact links yet: links are created
        // once the artifact itself exists.
        return toEventEnvelope(row!, []);
      });
    },

    async listByRun(runId) {
      const rows = await executor
        .select()
        .from(runEvents)
        .where(eq(runEvents.runId, runId))
        .orderBy(asc(runEvents.sequence));

      return withArtifactRefs(rows);
    },

    async listByRunSince(runId, afterSequence) {
      const rows = await executor
        .select()
        .from(runEvents)
        .where(and(eq(runEvents.runId, runId), gt(runEvents.sequence, afterSequence)))
        .orderBy(asc(runEvents.sequence));

      return withArtifactRefs(rows);
    },

    async findById(id) {
      const rows = await executor.select().from(runEvents).where(eq(runEvents.id, id)).limit(1);
      const envelopes = await withArtifactRefs(rows);
      return envelopes[0] ?? null;
    },
  };
}
