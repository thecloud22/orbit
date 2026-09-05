import { describe, expect, it } from 'vitest';

import {
  businessOutcomeSchema,
  isTerminalRunStatus,
  isTerminalRunStepStatus,
  runInputsSchema,
  runOutputsSchema,
  runStatusSchema,
  runStepStatusSchema,
  runTriggerSchema,
  terminalBusinessOutcomeSchema,
} from './run';

describe('run status', () => {
  it('accepts every Phase 1 status', () => {
    for (const status of ['queued', 'running', 'succeeded', 'failed', 'cancelled']) {
      expect(runStatusSchema.parse(status)).toBe(status);
    }
  });

  it('rejects an unknown status', () => {
    expect(runStatusSchema.safeParse('paused').success).toBe(false);
  });

  it('identifies terminal statuses', () => {
    expect(isTerminalRunStatus('succeeded')).toBe(true);
    expect(isTerminalRunStatus('failed')).toBe(true);
    expect(isTerminalRunStatus('running')).toBe(false);
  });
});

describe('business outcome', () => {
  it('is separate from run status: not-found is a valid outcome', () => {
    expect(businessOutcomeSchema.parse('request_not_found')).toBe('request_not_found');
  });

  it('allows none as a run-level outcome', () => {
    expect(businessOutcomeSchema.parse('none')).toBe('none');
  });

  it('does not allow none as a completion outcome', () => {
    expect(terminalBusinessOutcomeSchema.safeParse('none').success).toBe(false);
    expect(terminalBusinessOutcomeSchema.parse('request_found')).toBe('request_found');
  });
});

describe('run step status', () => {
  it('accepts the declared step statuses', () => {
    expect(runStepStatusSchema.parse('running')).toBe('running');
    expect(runStepStatusSchema.safeParse('cancelled').success).toBe(false);
  });

  it('knows which step statuses are terminal', () => {
    expect(isTerminalRunStepStatus('succeeded')).toBe(true);
    expect(isTerminalRunStepStatus('failed')).toBe(true);
    expect(isTerminalRunStepStatus('running')).toBe(false);
    expect(isTerminalRunStepStatus('pending')).toBe(false);
  });
});

describe('run trigger', () => {
  const trigger = {
    type: 'watchtower_manual',
    actor: { type: 'development_user', id: 'dev-user' },
    source: { application: 'orbit-watchtower' },
  };

  it('accepts the Phase 1 manual trigger envelope', () => {
    expect(runTriggerSchema.parse(trigger).actor.id).toBe('dev-user');
  });

  it('keeps the actor required so runs always record who started them', () => {
    expect(runTriggerSchema.safeParse({ type: trigger.type, source: trigger.source }).success).toBe(
      false,
    );
  });

  it('rejects a trigger type Phase 1 does not support', () => {
    expect(runTriggerSchema.safeParse({ ...trigger, type: 'schedule' }).success).toBe(false);
  });

  it('treats source as optional', () => {
    expect(runTriggerSchema.safeParse({ type: trigger.type, actor: trigger.actor }).success).toBe(
      true,
    );
  });
});

describe('run inputs and outputs', () => {
  it('accepts declared string values', () => {
    expect(runInputsSchema.parse({ requestNumber: 'SR-1001' })['requestNumber']).toBe('SR-1001');
    expect(runOutputsSchema.parse({ requestStatus: 'In Progress' })['requestStatus']).toBe(
      'In Progress',
    );
  });

  it('rejects non-string values, which Phase 1 does not declare', () => {
    expect(runInputsSchema.safeParse({ requestNumber: 1001 }).success).toBe(false);
  });
});
