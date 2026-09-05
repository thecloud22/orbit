import { describe, expect, it } from 'vitest';

import { artifactLinkSchema, artifactMetadataSchema } from './artifacts';

const sha256 = 'a'.repeat(64);

const validArtifact = {
  id: 'art_01JABC',
  runId: 'run_01JABC',
  runStepId: 'rstep_01JABC',
  kind: 'browser_screenshot',
  contentType: 'image/png',
  storageKey: 'runs/run_01JABC/steps/submit_request_search/after.png',
  sizeBytes: 12345,
  sha256,
  createdAt: '2026-09-05T16:00:00.000Z',
};

describe('artifact metadata', () => {
  it('accepts a screenshot artifact', () => {
    expect(artifactMetadataSchema.parse(validArtifact).kind).toBe('browser_screenshot');
  });

  it('rejects an unknown artifact kind', () => {
    expect(artifactMetadataSchema.safeParse({ ...validArtifact, kind: 'video' }).success).toBe(
      false,
    );
  });

  it('rejects a negative size', () => {
    expect(artifactMetadataSchema.safeParse({ ...validArtifact, sizeBytes: -1 }).success).toBe(
      false,
    );
  });

  it('rejects a malformed digest', () => {
    expect(artifactMetadataSchema.safeParse({ ...validArtifact, sha256: 'abc' }).success).toBe(
      false,
    );
    expect(
      artifactMetadataSchema.safeParse({ ...validArtifact, sha256: sha256.toUpperCase() }).success,
    ).toBe(false);
  });
});

describe('artifact links', () => {
  const link = {
    id: 'artl_01JABC',
    artifactId: 'art_01JABC',
    role: 'screenshot_after_action',
  };

  it('links an artifact to a run, a step, and an event', () => {
    expect(
      artifactLinkSchema.parse({ ...link, targetType: 'run', targetId: 'run_01JABC' }).targetType,
    ).toBe('run');

    expect(
      artifactLinkSchema.parse({
        ...link,
        role: 'browser_trace',
        targetType: 'run_event',
        targetId: 'evt_01JABC',
      }).targetType,
    ).toBe('run_event');
  });

  it('rejects a target id that does not match its target type', () => {
    expect(
      artifactLinkSchema.safeParse({ ...link, targetType: 'run_step', targetId: 'run_01JABC' })
        .success,
    ).toBe(false);
  });

  it('rejects an unsupported target type', () => {
    expect(
      artifactLinkSchema.safeParse({
        ...link,
        targetType: 'approval_request',
        targetId: 'run_01JABC',
      }).success,
    ).toBe(false);
  });

  it('requires a role, so evidence always says why an artifact is attached', () => {
    expect(
      artifactLinkSchema.safeParse({
        id: link.id,
        artifactId: link.artifactId,
        targetType: 'run',
        targetId: 'run_01JABC',
      }).success,
    ).toBe(false);

    expect(
      artifactLinkSchema.safeParse({
        ...link,
        role: 'looks_interesting',
        targetType: 'run',
        targetId: 'run_01JABC',
      }).success,
    ).toBe(false);
  });
});
