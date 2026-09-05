import { describe, expect, it } from 'vitest';

import { DatabaseIntegrityError } from '../errors';
import type { ArtifactLinkRow } from '../schema';
import { toArtifactLink } from './artifact';

const baseRow = {
  id: 'artl_01JABC',
  artifactId: 'art_01JABC',
  role: 'screenshot_after_action',
  runId: null,
  runStepId: null,
  runEventId: null,
  createdAt: new Date('2026-09-05T16:00:00.000Z'),
} as unknown as ArtifactLinkRow;

describe('artifact link mapping', () => {
  it('collapses the target columns into the contract union', () => {
    const link = toArtifactLink({ ...baseRow, runId: 'run_01JABC' } as ArtifactLinkRow);

    expect(link.targetType).toBe('run');
    expect(link.targetId).toBe('run_01JABC');
    expect(link.role).toBe('screenshot_after_action');
  });

  it('maps step and event targets', () => {
    expect(
      toArtifactLink({ ...baseRow, runStepId: 'rstep_01JABC' } as ArtifactLinkRow).targetType,
    ).toBe('run_step');
    expect(
      toArtifactLink({ ...baseRow, runEventId: 'evt_01JABC' } as ArtifactLinkRow).targetType,
    ).toBe('run_event');
  });

  it('raises on a targetless row instead of inventing a target', () => {
    expect(() => toArtifactLink(baseRow)).toThrow(DatabaseIntegrityError);
  });

  it('raises when a row violates the link contract', () => {
    expect(() =>
      toArtifactLink({ ...baseRow, runId: 'not-an-opaque-id' } as ArtifactLinkRow),
    ).toThrow(DatabaseIntegrityError);
  });
});
