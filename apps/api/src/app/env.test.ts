import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveRepositoryArtifactRoot } from './env';

/**
 * Where artifact bytes actually land.
 *
 * This exists because the answer was wrong for a while and nothing noticed.
 * `REPOSITORY_ROOT` is derived from this module's own location, so moving the
 * file one directory deeper redirected every screenshot, DOM snapshot and trace
 * into `apps/data/` — still inside the repository, but outside the `/data/`
 * rule in `.gitignore` and `.prettierignore`. Nothing failed: runs succeeded,
 * evidence was written and read back, and the only symptom was untracked files
 * accumulating somewhere nobody looks.
 *
 * A relative path resolved against a file's own location is a path that breaks
 * when the file moves, quietly. So the property is asserted rather than
 * commented: the resolved root must be the repository, identified by something
 * only the repository root has.
 */
describe('resolveRepositoryArtifactRoot', () => {
  it('resolves a relative path against the repository root, not this directory', () => {
    const root = resolveRepositoryArtifactRoot({ ARTIFACT_STORAGE_DIR: './data/artifacts' });

    // `pnpm-workspace.yaml` exists at the repository root and nowhere else, so
    // this pins the location without hard-coding a path that would itself go
    // stale.
    expect(existsSync(join(root, '..', '..', 'pnpm-workspace.yaml'))).toBe(true);
    expect(root.endsWith(join('data', 'artifacts'))).toBe(true);
    expect(root).not.toContain(join('apps', 'data'));
  });

  it('honours an absolute path as given', () => {
    const root = resolveRepositoryArtifactRoot({ ARTIFACT_STORAGE_DIR: '/tmp/orbit-artifacts' });
    expect(root).toBe('/tmp/orbit-artifacts');
  });

  it('refuses to guess when nothing is configured', () => {
    expect(() => resolveRepositoryArtifactRoot({})).toThrow(/ARTIFACT_STORAGE_DIR/);
  });
});
