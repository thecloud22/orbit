import { describe, expect, it } from 'vitest';

import { DatabaseIntegrityError } from '../errors';
import type { RunEventRow } from '../schema';
import { toEventEnvelope } from './run-event';

const row = {
  id: 'evt_01JABC',
  runId: 'run_01JABC',
  runStepId: null,
  agentVersionId: 'agentv_01JABC',
  agentStepId: null,
  attempt: null,
  schemaVersion: '0.1',
  eventType: 'run.queued',
  sequence: 1,
  occurredAt: new Date('2026-09-05T16:00:00.000Z'),
  payload: { source: 'watchtower' },
  createdAt: new Date('2026-09-05T16:00:00.000Z'),
} as unknown as RunEventRow;

describe('event envelope mapping', () => {
  it('omits step fields for run-scoped lifecycle events', () => {
    const envelope = toEventEnvelope(row, []);

    expect(envelope).not.toHaveProperty('runStepId');
    expect(envelope).not.toHaveProperty('agentStepId');
    expect(envelope.occurredAt).toBe('2026-09-05T16:00:00.000Z');
    expect(envelope.sequence).toBe(1);
  });

  it('carries step context when the event belongs to a step', () => {
    const envelope = toEventEnvelope(
      { ...row, runStepId: 'rstep_01JABC', agentStepId: 'submit_request_search' } as RunEventRow,
      [],
    );

    expect(envelope.runStepId).toBe('rstep_01JABC');
    expect(envelope.agentStepId).toBe('submit_request_search');
  });

  it('takes artifact references from the links rather than the row', () => {
    const envelope = toEventEnvelope(row, ['art_01JABC', 'art_01JABD'] as never);
    expect(envelope.artifactRefs).toEqual(['art_01JABC', 'art_01JABD']);
  });

  it('raises when a row does not satisfy the envelope contract', () => {
    // A value the column type forbids but a corrupted row could still hold.
    const corrupted = { ...row, eventType: 'run.exploded' } as unknown as RunEventRow;
    expect(() => toEventEnvelope(corrupted, [])).toThrow(DatabaseIntegrityError);
  });
});
