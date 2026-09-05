import { describe, expect, it } from 'vitest';

import {
  agentIdSchema,
  artifactIdSchema,
  eventIdSchema,
  runIdSchema,
  runStepIdSchema,
} from './ids';

describe('opaque ids', () => {
  it('accepts correctly prefixed ids', () => {
    expect(runIdSchema.parse('run_01JABC')).toBe('run_01JABC');
    expect(agentIdSchema.parse('agent_find_service_request')).toBe('agent_find_service_request');
    expect(runStepIdSchema.parse('rstep_01JABC')).toBe('rstep_01JABC');
    expect(eventIdSchema.parse('evt_01JABC')).toBe('evt_01JABC');
    expect(artifactIdSchema.parse('art_01JABC')).toBe('art_01JABC');
  });

  it('rejects an id with the wrong prefix', () => {
    expect(runIdSchema.safeParse('agentv_01JABC').success).toBe(false);
    expect(runIdSchema.safeParse('01JABC').success).toBe(false);
  });

  it('rejects a prefix with no body', () => {
    expect(runIdSchema.safeParse('run_').success).toBe(false);
  });

  it('rejects ids containing separators that would break log parsing', () => {
    expect(runIdSchema.safeParse('run_01 JABC').success).toBe(false);
    expect(runIdSchema.safeParse('run_01/JABC').success).toBe(false);
  });
});
