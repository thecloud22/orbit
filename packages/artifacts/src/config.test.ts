import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { assertUsableArtifactRoot, resolveArtifactRoot } from './config';
import { StorageRootError } from './errors';

describe('resolveArtifactRoot', () => {
  it('throws when ARTIFACT_STORAGE_DIR is absent', () => {
    expect(() => resolveArtifactRoot({})).toThrow(StorageRootError);
  });

  it('throws when ARTIFACT_STORAGE_DIR is empty', () => {
    expect(() => resolveArtifactRoot({ ARTIFACT_STORAGE_DIR: '' })).toThrow(StorageRootError);
  });

  it('throws when ARTIFACT_STORAGE_DIR is whitespace', () => {
    expect(() => resolveArtifactRoot({ ARTIFACT_STORAGE_DIR: '   ' })).toThrow(StorageRootError);
  });

  it('resolves a relative path to an absolute one', () => {
    const result = resolveArtifactRoot({ ARTIFACT_STORAGE_DIR: './data/artifacts' });

    expect(result).toBe(resolve('./data/artifacts'));
  });
});

describe('assertUsableArtifactRoot', () => {
  it('throws for the filesystem root', () => {
    expect(() => assertUsableArtifactRoot('/')).toThrow(StorageRootError);
  });

  it.each(['/repo/public/artifacts', '/repo/dist/artifacts', '/repo/node_modules/artifacts'])(
    'throws for a root containing a forbidden segment: %s',
    (root) => {
      expect(() => assertUsableArtifactRoot(root)).toThrow(StorageRootError);
    },
  );

  it('throws regardless of where the forbidden segment appears in the path', () => {
    expect(() => assertUsableArtifactRoot('/public/repo/artifacts')).toThrow(StorageRootError);
    expect(() => assertUsableArtifactRoot('/repo/artifacts/dist')).toThrow(StorageRootError);
  });

  it('accepts an ordinary absolute path', () => {
    const root = '/tmp/orbit-artifacts-check';

    expect(assertUsableArtifactRoot(root)).toBe(root);
  });
});
