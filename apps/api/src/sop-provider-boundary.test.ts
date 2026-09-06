import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The deterministic fake model provider must not be reachable from the shipped
 * API.
 *
 * The end-to-end stack needs an API that generates business content without
 * calling a model. The tempting way to arrange that is a branch in `index.ts`
 * selecting a fake when some variable is set — and that is precisely a live path
 * to a test double in a real deployment, gated by something someone could set by
 * accident. So there is no such branch: the shipped entry point constructs the
 * real provider unconditionally, and a separate test-only entry point under
 * `src/testing/` passes the fake to the same `startApi`.
 *
 * This is the guard that proves it, and it is transitive rather than
 * file-local: a single import three modules deep would defeat a shallower
 * check.
 */

const SOURCE_ROOT = fileURLToPath(new URL('.', import.meta.url));

const TEST_ONLY_SUBPATHS = [
  '@orbit/sop-generation/testing',
  '@orbit/sop-graph/testing',
  '@orbit/db/testing',
  '@orbit/artifacts/testing',
  '@orbit/runtime/testing',
];

const IMPORT_PATTERN = /(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;

function importsOf(file: string): readonly string[] {
  const contents = readFileSync(file, 'utf8');
  const found: string[] = [];

  for (const match of contents.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1];

    if (specifier !== undefined) {
      found.push(specifier);
    }
  }

  return found;
}

/** Resolves a relative specifier the way the bundler and tsx both would. */
function resolveLocal(fromFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) {
    return undefined;
  }

  const base = resolve(dirname(fromFile), specifier);

  for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

/** Every module the given entry point can reach through this app's own source. */
function moduleGraphFrom(entry: string): readonly string[] {
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop();

    if (file === undefined || seen.has(file)) {
      continue;
    }

    seen.add(file);

    for (const specifier of importsOf(file)) {
      const local = resolveLocal(file, specifier);

      if (local !== undefined) {
        queue.push(local);
      }
    }
  }

  return [...seen];
}

function allSourceFiles(directory: string): readonly string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...allSourceFiles(path));
    } else if (entry.name.endsWith('.ts')) {
      found.push(path);
    }
  }

  return found;
}

function usesTestOnlySubpath(file: string): boolean {
  return importsOf(file).some((specifier) => TEST_ONLY_SUBPATHS.includes(specifier));
}

describe('the fake model provider stays out of the shipped API', () => {
  const entry = join(SOURCE_ROOT, 'index.ts');

  it('reaches the real composition from the shipped entry point', () => {
    const graph = moduleGraphFrom(entry).map((file) => relative(SOURCE_ROOT, file));

    expect(graph).toContain('bootstrap.ts');
    expect(graph).toContain('server.ts');
    expect(graph).toContain('routes/sop-drafts.ts');
  });

  it('cannot reach a test-only subpath from the shipped entry point, at any depth', () => {
    const offenders = moduleGraphFrom(entry)
      .filter(usesTestOnlySubpath)
      .map((file) => relative(SOURCE_ROOT, file));

    expect(offenders).toEqual([]);
  });

  it('has no provider switch in the shipped entry point', () => {
    const contents = readFileSync(entry, 'utf8');

    // The real provider, chosen unconditionally.
    expect(contents).toContain('createAnthropicSopProvider');

    // And nothing that could select otherwise. The fake is checked against the
    // parsed imports rather than the raw text on purpose: this file's own
    // documentation names the subpath while explaining that it does not import
    // it, and a scan that punished writing that down would be a scan that
    // encouraged leaving the boundary unexplained.
    expect(importsOf(entry)).not.toContain('@orbit/sop-generation/testing');
    expect(contents).not.toContain('ORBIT_SOP_PROVIDER');
    expect(contents).not.toContain('createFakeSopProvider');
  });

  it('confines test-only imports to test files and the test-only entry point', () => {
    const offenders = allSourceFiles(SOURCE_ROOT)
      .filter(usesTestOnlySubpath)
      .map((file) => relative(SOURCE_ROOT, file))
      .filter((file) => !file.endsWith('.test.ts') && !file.startsWith('testing/'));

    expect(offenders).toEqual([]);
  });

  it('keeps the test-only entry point separate from the shipped one', () => {
    const e2e = join(SOURCE_ROOT, 'testing', 'e2e-server.ts');

    expect(existsSync(e2e)).toBe(true);

    const contents = readFileSync(e2e, 'utf8');

    // It composes through the same production bootstrap, so an end-to-end run
    // exercises the real routes and persistence.
    expect(contents).toContain("from '../bootstrap'");

    // And it refuses to serve anything but the test database, so running it by
    // hand against development data exits instead of fabricating business
    // content there.
    expect(contents).toContain('orbit_test');
    expect(contents).toContain('databaseNameFromUrl');
  });
});
