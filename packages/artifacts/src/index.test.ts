import { describe, expect, it } from 'vitest';

import {
  ArtifactStorageError,
  ARTIFACT_KIND_EXTENSIONS,
  createLocalFilesystemArtifactStorage,
  parseArtifactStorageKey,
  PACKAGE_NAME,
  resolveArtifactRoot,
} from './index';

describe('@orbit/artifacts', () => {
  it('exposes its package identity', () => {
    expect(PACKAGE_NAME).toBe('@orbit/artifacts');
  });

  it('re-exports the storage key, config, content type, error, and adapter APIs', () => {
    expect(typeof parseArtifactStorageKey).toBe('function');
    expect(typeof resolveArtifactRoot).toBe('function');
    expect(typeof createLocalFilesystemArtifactStorage).toBe('function');
    expect(ARTIFACT_KIND_EXTENSIONS).toBeDefined();
    expect(ArtifactStorageError).toBeDefined();
  });
});
