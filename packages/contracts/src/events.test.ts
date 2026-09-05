import { describe, expect, it } from 'vitest';

import { eventEnvelopeSchema, eventTypeSchema } from './events';

const validEvent = {
  id: 'evt_01JABC',
  schemaVersion: '0.1',
  runId: 'run_01JABC',
  runStepId: 'rstep_01JABC',
  agentVersionId: 'agentv_01JABC',
  agentStepId: 'submit_request_search',
  eventType: 'browser.click.completed',
  occurredAt: '2026-09-05T16:00:00.000Z',
  sequence: 12,
  payload: {},
  artifactRefs: [],
};

describe('event envelope', () => {
  it('accepts a complete event', () => {
    const parsed = eventEnvelopeSchema.parse(validEvent);
    expect(parsed.sequence).toBe(12);
  });

  it('accepts a run-scoped event with no step identifiers', () => {
    const { runStepId, agentStepId, ...runScoped } = validEvent;
    void runStepId;
    void agentStepId;

    const parsed = eventEnvelopeSchema.parse({ ...runScoped, eventType: 'run.queued' });
    expect(parsed.runStepId).toBeUndefined();
  });

  it('rejects an unknown event type', () => {
    expect(eventEnvelopeSchema.safeParse({ ...validEvent, eventType: 'run.paused' }).success).toBe(
      false,
    );
  });

  it('rejects a negative or fractional sequence', () => {
    expect(eventEnvelopeSchema.safeParse({ ...validEvent, sequence: -1 }).success).toBe(false);
    expect(eventEnvelopeSchema.safeParse({ ...validEvent, sequence: 1.5 }).success).toBe(false);
  });

  it('rejects a non-ISO timestamp', () => {
    expect(
      eventEnvelopeSchema.safeParse({ ...validEvent, occurredAt: '5 September 2026' }).success,
    ).toBe(false);
  });

  it('rejects artifact references that are not artifact ids', () => {
    expect(
      eventEnvelopeSchema.safeParse({ ...validEvent, artifactRefs: ['run_01JABC'] }).success,
    ).toBe(false);
  });

  it('covers every documented Phase 1 event type', () => {
    expect(eventTypeSchema.options).toHaveLength(14);
    expect(eventTypeSchema.options).toContain('artifact.created');
    expect(eventTypeSchema.options).toContain('assertion.failed');
  });
});
