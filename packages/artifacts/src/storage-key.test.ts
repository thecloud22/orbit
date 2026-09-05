import { newArtifactId, newRunId, newRunStepId } from '@orbit/contracts';
import { describe, expect, it } from 'vitest';

import { ARTIFACT_KINDS } from './content-types';
import { InvalidStorageKeyError } from './errors';
import {
  buildArtifactStorageKey,
  isArtifactStorageKey,
  parseArtifactStorageKey,
  storageKeyViolation,
} from './storage-key';

const VALID_RUN_SCOPED_KEY = 'runs/run_01JABC/art_01JABC.png';
const VALID_STEP_SCOPED_KEY = 'runs/run_01JABC/steps/rstep_01JABC/art_01JABC.png';

const INVALID_KEYS: ReadonlyArray<[label: string, value: string]> = [
  ['empty string', ''],
  ['absolute path', '/runs/x'],
  ['Windows-style absolute path', 'C:\\runs\\x'],
  ['a "." segment', 'runs/./x'],
  ['a ".." segment', 'runs/../etc/passwd'],
  ['a backslash', 'runs\\x'],
  ['leading slash', '/runs/x/y'],
  ['trailing slash', 'runs/x/'],
  ['double slash', 'runs//x'],
  ['a space', 'runs/x y/z'],
  ['a tab', 'runs/x\ty/z'],
  ['a control character', 'runs/x\u0001y/z'],
  ['a NUL byte', 'runs/x\u0000y/z'],
  ['non-ASCII characters', 'runs/café/x'],
  ['a segment starting with "_"', 'runs/_x/y'],
  ['a segment starting with "-"', 'runs/-x/y'],
  ['a segment over 128 characters', `runs/${'a'.repeat(129)}/y`],
  [
    'a key over 512 characters, made of otherwise-valid segments',
    Array.from({ length: 6 }, (_, i) => `${'a'.repeat(90)}${i}`).join('/'),
  ],
  ['9 segments', Array.from({ length: 9 }, (_, i) => `s${i}`).join('/')],
  ['an extension on a non-final segment', 'runs/a.png/b'],
];

describe('storage key grammar', () => {
  it('accepts a valid run-scoped key', () => {
    expect(parseArtifactStorageKey(VALID_RUN_SCOPED_KEY)).toBe(VALID_RUN_SCOPED_KEY);
  });

  it('accepts a valid step-scoped key', () => {
    expect(parseArtifactStorageKey(VALID_STEP_SCOPED_KEY)).toBe(VALID_STEP_SCOPED_KEY);
  });

  it.each(INVALID_KEYS)('rejects %s via parseArtifactStorageKey', (_label, value) => {
    expect(() => parseArtifactStorageKey(value)).toThrow(InvalidStorageKeyError);
  });

  it.each(INVALID_KEYS)('rejects %s via isArtifactStorageKey', (_label, value) => {
    expect(isArtifactStorageKey(value)).toBe(false);
  });

  it('accepts valid keys via isArtifactStorageKey', () => {
    expect(isArtifactStorageKey(VALID_RUN_SCOPED_KEY)).toBe(true);
    expect(isArtifactStorageKey(VALID_STEP_SCOPED_KEY)).toBe(true);
  });

  it.each(INVALID_KEYS)('storageKeyViolation reports a reason for %s', (_label, value) => {
    expect(storageKeyViolation(value)).toEqual(expect.any(String));
  });

  it('storageKeyViolation reports no violation for valid keys', () => {
    expect(storageKeyViolation(VALID_RUN_SCOPED_KEY)).toBeUndefined();
    expect(storageKeyViolation(VALID_STEP_SCOPED_KEY)).toBeUndefined();
  });
});

describe('buildArtifactStorageKey', () => {
  it('builds a run-scoped key', () => {
    const runId = newRunId();
    const artifactId = newArtifactId();

    const key = buildArtifactStorageKey({ runId, artifactId, kind: 'browser_screenshot' });

    expect(key).toBe(`runs/${runId}/${artifactId}.png`);
  });

  it('builds a step-scoped key', () => {
    const runId = newRunId();
    const runStepId = newRunStepId();
    const artifactId = newArtifactId();

    const key = buildArtifactStorageKey({
      runId,
      artifactId,
      runStepId,
      kind: 'dom_snapshot',
    });

    expect(key).toBe(`runs/${runId}/steps/${runStepId}/${artifactId}.html`);
  });

  it('always produces a key that re-parses successfully', () => {
    const key = buildArtifactStorageKey({
      runId: newRunId(),
      runStepId: newRunStepId(),
      artifactId: newArtifactId(),
      kind: 'browser_trace',
    });

    expect(() => parseArtifactStorageKey(key)).not.toThrow();
  });

  it('produces a parseable key for every artifact kind', () => {
    for (const kind of ARTIFACT_KINDS) {
      const key = buildArtifactStorageKey({
        runId: newRunId(),
        artifactId: newArtifactId(),
        kind,
      });

      expect(() => parseArtifactStorageKey(key)).not.toThrow();
    }
  });
});
