import { describe, expect, it } from 'vitest';

import {
  generateUlid,
  newAgentId,
  newAgentVersionId,
  newArtifactId,
  newArtifactLinkId,
  newEventId,
  newRequestId,
  newRunId,
  newRunStepId,
} from './generate-id';
import {
  agentIdSchema,
  agentVersionIdSchema,
  artifactIdSchema,
  artifactLinkIdSchema,
  eventIdSchema,
  requestIdSchema,
  runIdSchema,
  runStepIdSchema,
} from './ids';

describe('generated ids', () => {
  it('produces ids that satisfy their own schema', () => {
    expect(agentIdSchema.safeParse(newAgentId()).success).toBe(true);
    expect(agentVersionIdSchema.safeParse(newAgentVersionId()).success).toBe(true);
    expect(runIdSchema.safeParse(newRunId()).success).toBe(true);
    expect(runStepIdSchema.safeParse(newRunStepId()).success).toBe(true);
    expect(eventIdSchema.safeParse(newEventId()).success).toBe(true);
    expect(artifactIdSchema.safeParse(newArtifactId()).success).toBe(true);
    expect(artifactLinkIdSchema.safeParse(newArtifactLinkId()).success).toBe(true);
    expect(requestIdSchema.safeParse(newRequestId()).success).toBe(true);
  });

  it('prefixes each entity type distinctly', () => {
    expect(newRunId().startsWith('run_')).toBe(true);
    expect(newRunStepId().startsWith('rstep_')).toBe(true);
    expect(newAgentVersionId().startsWith('agentv_')).toBe(true);
    // A run step id must not be mistakable for a run id.
    expect(runIdSchema.safeParse(newRunStepId()).success).toBe(false);
  });

  it('uses the 26-character Crockford base32 ULID body', () => {
    expect(generateUlid()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('is unique across a tight loop', () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => generateUlid()));
    expect(ids.size).toBe(10_000);
  });

  it('sorts lexicographically in generation order, including within one millisecond', () => {
    const ids = Array.from({ length: 1_000 }, () => generateUlid());
    expect([...ids].sort()).toEqual(ids);
  });
});
