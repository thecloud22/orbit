import { newEventId } from '@orbit/contracts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { isUniqueViolation, violatedConstraint } from '../errors';
import { runEvents } from '../schema';
import { createTestRun, seedTestAgentVersion } from '../testing/factories';
import { useTestDatabase } from '../testing/harness';
import { createRepositories } from './index';

const testDatabase = useTestDatabase();

async function runContext() {
  const { db } = testDatabase();
  const agentVersion = await seedTestAgentVersion(db);
  const run = await createTestRun(db, agentVersion.id);
  return { db, agentVersion, run, repositories: createRepositories(db) };
}

describe('run events', () => {
  it('appends events with a strictly increasing per-run sequence', async () => {
    const { run, agentVersion, repositories } = await runContext();

    for (const eventType of ['run.queued', 'run.started', 'step.started'] as const) {
      await repositories.runEvents.append({
        runId: run.id,
        agentVersionId: agentVersion.id,
        eventType,
      });
    }

    const events = await repositories.runEvents.listByRun(run.id);

    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(events.map((event) => event.eventType)).toEqual([
      'run.queued',
      'run.started',
      'step.started',
    ]);
  });

  it('orders by sequence, never by timestamp', async () => {
    const { run, agentVersion, repositories } = await runContext();

    // Deliberately inverted clocks: the second event claims an earlier time.
    await repositories.runEvents.append({
      runId: run.id,
      agentVersionId: agentVersion.id,
      eventType: 'run.queued',
      occurredAt: new Date('2026-09-05T16:00:05.000Z'),
    });
    await repositories.runEvents.append({
      runId: run.id,
      agentVersionId: agentVersion.id,
      eventType: 'run.started',
      occurredAt: new Date('2026-09-05T16:00:01.000Z'),
    });

    const events = await repositories.runEvents.listByRun(run.id);

    expect(events.map((event) => event.eventType)).toEqual(['run.queued', 'run.started']);
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
  });

  it('keeps sequences unique and gapless under concurrent appends', async () => {
    const { run, agentVersion, repositories } = await runContext();

    await Promise.all(
      Array.from({ length: 25 }, () =>
        repositories.runEvents.append({
          runId: run.id,
          agentVersionId: agentVersion.id,
          eventType: 'assertion.passed',
        }),
      ),
    );

    const events = await repositories.runEvents.listByRun(run.id);
    const sequences = events.map((event) => event.sequence);

    expect(new Set(sequences).size).toBe(25);
    expect(sequences).toEqual(Array.from({ length: 25 }, (_unused, index) => index + 1));
  });

  it('scopes sequences to a run, so two runs both start at 1', async () => {
    const { db, agentVersion, run, repositories } = await runContext();
    const other = await createTestRun(db, agentVersion.id);

    await repositories.runEvents.append({
      runId: run.id,
      agentVersionId: agentVersion.id,
      eventType: 'run.queued',
    });
    const otherEvent = await repositories.runEvents.append({
      runId: other.id,
      agentVersionId: agentVersion.id,
      eventType: 'run.queued',
    });

    expect(otherEvent.sequence).toBe(1);
    expect(await repositories.runEvents.listByRun(other.id)).toHaveLength(1);
  });

  it('rejects a duplicate sequence within one run', async () => {
    const { db, run, agentVersion, repositories } = await runContext();

    await repositories.runEvents.append({
      runId: run.id,
      agentVersionId: agentVersion.id,
      eventType: 'run.queued',
    });

    const error = await db
      .insert(runEvents)
      .values({
        id: newEventId(),
        runId: run.id,
        agentVersionId: agentVersion.id,
        eventType: 'run.started',
        sequence: 1,
        occurredAt: new Date(),
      })
      .catch((caught: unknown) => caught);

    expect(isUniqueViolation(error)).toBe(true);
    expect(violatedConstraint(error)).toBe('run_events_run_id_sequence_unique');
  });

  it('rejects an event type outside the contract taxonomy', async () => {
    const { db, run, agentVersion } = await runContext();

    const error = await db
      .insert(runEvents)
      .values({
        id: newEventId(),
        runId: run.id,
        agentVersionId: agentVersion.id,
        eventType: 'run.exploded' as never,
        sequence: 99,
        occurredAt: new Date(),
      })
      .catch((caught: unknown) => caught);

    expect(violatedConstraint(error)).toBe('run_events_event_type_check');
  });

  it('produces envelopes that satisfy the events contract', async () => {
    const { run, agentVersion, repositories } = await runContext();

    const step = await repositories.runSteps.start({
      runId: run.id,
      agentStepId: 'submit_request_search',
      stepType: 'browser.click',
    });

    const envelope = await repositories.runEvents.append({
      runId: run.id,
      agentVersionId: agentVersion.id,
      runStepId: step.id,
      agentStepId: 'submit_request_search',
      attempt: 1,
      eventType: 'browser.click.completed',
      payload: { locator: { strategy: 'test_id', value: 'search-request-button' } },
    });

    expect(envelope.schemaVersion).toBe('0.1');
    expect(envelope.runId).toBe(run.id);
    expect(envelope.runStepId).toBe(step.id);
    expect(envelope.agentVersionId).toBe(agentVersion.id);
    expect(envelope.agentStepId).toBe('submit_request_search');
    expect(envelope.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(envelope.artifactRefs).toEqual([]);
    expect(envelope.payload).toEqual({
      locator: { strategy: 'test_id', value: 'search-request-button' },
    });
  });

  it('persists the attempt for the retry design, outside the envelope contract', async () => {
    const { db, run, agentVersion, repositories } = await runContext();

    const envelope = await repositories.runEvents.append({
      runId: run.id,
      agentVersionId: agentVersion.id,
      eventType: 'step.started',
      agentStepId: 'open_request_portal',
      attempt: 1,
    });

    const [row] = await db.select().from(runEvents).where(eq(runEvents.id, envelope.id));
    expect(row?.attempt).toBe(1);
    // The envelope contract has no attempt field, so it is not smuggled in.
    expect(envelope).not.toHaveProperty('attempt');
  });

  it('omits step context for run-scoped lifecycle events', async () => {
    const { run, agentVersion, repositories } = await runContext();

    const envelope = await repositories.runEvents.append({
      runId: run.id,
      agentVersionId: agentVersion.id,
      eventType: 'run.completed',
      payload: { businessOutcome: 'request_found' },
    });

    expect(envelope).not.toHaveProperty('runStepId');
    expect(envelope).not.toHaveProperty('agentStepId');
  });

  it('exposes no way to rewrite the event log', () => {
    const { runEvents: repository } = createRepositories(testDatabase().db);
    const methods = Object.keys(repository).sort();

    expect(methods).toEqual(['append', 'findById', 'listByRun', 'listByRunSince']);
  });

  it('reads only what a poller has not already seen', async () => {
    const { run, agentVersion, repositories } = await runContext();

    for (const eventType of ['run.queued', 'run.started', 'run.completed'] as const) {
      await repositories.runEvents.append({
        runId: run.id,
        agentVersionId: agentVersion.id,
        eventType,
      });
    }

    const since = await repositories.runEvents.listByRunSince(run.id, 1);

    expect(since.map((event) => event.sequence)).toEqual([2, 3]);
  });
});
