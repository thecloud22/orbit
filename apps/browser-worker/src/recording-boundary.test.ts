import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The process that executes agents cannot write a recorded workflow.
 *
 * Recording produces bindings that land *approved*, which is the widest write
 * capability in Orbit — it says a human confirmed a step by performing it. That
 * claim must only ever be made by the thing that actually watched them do it,
 * so the path to it stays out of the run executor entirely, alongside the
 * script-injection ban ADR-019 already put here.
 */
const SOURCE_ROOT = fileURLToPath(new URL('.', import.meta.url));

const FORBIDDEN = ['@orbit/sop-service', '@orbit/sop-recording', '@orbit/execution-recorder'];

const IMPORT_PATTERN = /(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;

function importsOf(file: string): readonly string[] {
  return [...readFileSync(file, 'utf8').matchAll(IMPORT_PATTERN)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

/** Resolves a relative import the way the bundler would. */
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

/** Every module the entry point can reach through this app's own source. */
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

describe('the run executor cannot create a recorded workflow', () => {
  const entry = join(SOURCE_ROOT, 'cli', 'run-agent.ts');

  it('has an entry point to scan', () => {
    expect(existsSync(entry)).toBe(true);
  });

  it('cannot reach the recording write path at any depth', () => {
    // Transitive, not file-local: a single import three modules down would
    // defeat a shallower check.
    const offences: string[] = [];

    for (const file of moduleGraphFrom(entry)) {
      for (const specifier of importsOf(file)) {
        if (
          FORBIDDEN.some((banned) => specifier === banned || specifier.startsWith(`${banned}/`))
        ) {
          offences.push(`${relative(SOURCE_ROOT, file)} imports "${specifier}"`);
        }
      }
    }

    expect(offences).toEqual([]);
  });

  it('does not declare any of them as a dependency either', () => {
    // Structural, not just unused: what it cannot resolve, it cannot import
    // later by accident.
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { readonly dependencies?: Readonly<Record<string, string>> };

    for (const banned of FORBIDDEN) {
      expect(Object.keys(manifest.dependencies ?? {})).not.toContain(banned);
    }
  });
});
