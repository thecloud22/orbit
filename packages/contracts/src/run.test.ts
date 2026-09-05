import { describe, expect, it } from 'vitest';

import {
  businessOutcomeSchema,
  isTerminalRunStatus,
  runStatusSchema,
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
