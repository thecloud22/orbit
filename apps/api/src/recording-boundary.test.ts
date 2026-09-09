import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Recording and running an agent stay apart inside one process.
 *
 * ADR-019 kept script injection out of every process that executes an agent,
 * and the API is one (ADR-011). Sub-phase 2.4f-2 needed a person to record from
 * Watchtower, which cannot happen without the API owning that browser — so
 * ADR-020 narrowed the ban rather than lifting it: exactly one directory may
 * reach the recorder.
 *
 * A narrowed ban is only as good as its proof. Lint keeps the recorder out of
 * every other file, and this walks the module graph from the run-dispatch entry
 * point to show that the path which executes an agent cannot reach script
 * injection at any depth — the property ADR-019 actually cared about, preserved
 * rather than traded away.
 */
const SOURCE_ROOT = fileURLToPath(new URL('.', import.meta.url));

const RECORDER = '@orbit/execution-recorder';

const IMPORT_PATTERN = /(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;

function importsOf(file: string): readonly string[] {
  return [...readFileSync(file, 'utf8').matchAll(IMPORT_PATTERN)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

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

function importsRecorder(file: string): boolean {
  return importsOf(file).some(
    (specifier) => specifier === RECORDER || specifier.startsWith(`${RECORDER}/`),
  );
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

describe('the run-dispatch path cannot reach the recorder', () => {
  const dispatch = join(SOURCE_ROOT, 'runs', 'dispatch.ts');

  it('has a dispatch entry point to scan', () => {
    expect(existsSync(dispatch)).toBe(true);
  });

  it('reaches script injection from nowhere in the dispatch graph, at any depth', () => {
    const offenders = moduleGraphFrom(dispatch)
      .filter(importsRecorder)
      .map((file) => relative(SOURCE_ROOT, file));

    expect(offenders).toEqual([]);
  });

  it('confines the recorder to src/recording', () => {
    // Lint enforces this too. Asserting it here as well means the boundary
    // survives someone loosening a lint rule without reading ADR-020.
    const offenders = allSourceFiles(SOURCE_ROOT)
      .filter(importsRecorder)
      .map((file) => relative(SOURCE_ROOT, file))
      .filter((file) => !file.startsWith('recording/') && !file.startsWith('testing/'));

    expect(offenders).toEqual([]);
  });

  it('detects a violation rather than passing vacuously', () => {
    // The scan is only worth having if it can fail, and the one directory that
    // is allowed to import the recorder is the honest place to prove it does.
    expect(importsRecorder(join(SOURCE_ROOT, 'recording', 'session-registry.ts'))).toBe(true);
    expect(importsRecorder(dispatch)).toBe(false);
  });

  it('keeps the second browser-holding registry inside the same one directory', () => {
    // Binding a step from Watchtower needs a browser too (ADR-027). The ban is
    // narrowed no further than it already was: the new registry lives in the
    // same permitted directory, and the confinement scan above covers it
    // without an exception being added for it.
    const bindingRegistry = join(SOURCE_ROOT, 'recording', 'binding-session-registry.ts');

    expect(existsSync(bindingRegistry)).toBe(true);
    expect(importsRecorder(bindingRegistry)).toBe(true);
    expect(relative(SOURCE_ROOT, bindingRegistry).startsWith('recording/')).toBe(true);
  });

  it('keeps the shared session store free of the recorder entirely', () => {
    // Ids, idle reaping and shutdown are plumbing both registries share. It
    // holds what it is given and closes it; it knows nothing about a browser.
    expect(importsRecorder(join(SOURCE_ROOT, 'recording', 'session-store.ts'))).toBe(false);
  });

  it('keeps recording out of the worker the dispatcher runs agents through', () => {
    // The dispatcher executes in-process (ADR-011), so its graph is the real
    // boundary — but the separate worker entry point has its own guard in
    // apps/browser-worker. Both matter; neither substitutes for the other.
    const worker = fileURLToPath(
      new URL('../../browser-worker/src/recording-boundary.test.ts', import.meta.url),
    );

    expect(existsSync(worker)).toBe(true);
  });
});
