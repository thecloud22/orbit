import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The runtime drives nothing itself.
 *
 * ADR-008 put Playwright behind an executor boundary so the runtime depends on
 * the interface and never on the engine. ADR-037 widened that from one browser
 * interface to a surface seam: `SurfaceExecutor` and `ExecutorFactories` are
 * what this package holds, and every implementation is injected by a composition
 * root -- `apps/api` and `apps/browser-worker`.
 *
 * That claim is easy to state and easy to break. A single import of
 * @orbit/executor-playwright here would still typecheck, still pass every other
 * test, and would quietly make the interpreter depend on a browser engine --
 * which is precisely the coupling the seam exists to prevent, and the thing that
 * would make a second surface impossible to add without a rewrite.
 *
 * @orbit/credentials is on the list for the same reason @orbit/decision-judge is
 * on the neighbouring test's: it is Orbit's own implementation of a port this
 * package declares, so importing it would look entirely reasonable in a diff
 * while removing the seam's only guarantee.
 *
 * Mirrors `decision-judge-boundary.test.ts`, which makes the same structural
 * argument about the model seam.
 */
const SOURCE_ROOT = fileURLToPath(new URL('.', import.meta.url));
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Execution engines, and the Orbit packages that hold one.
 *
 * The two `@orbit/executor-*` entries that do not exist yet are deliberate. An
 * entry for a package nobody has written is inert, which is the point: it fails
 * on the commit that adds one, rather than relying on somebody remembering this
 * file at that moment.
 */
const FORBIDDEN = [
  'playwright',
  'puppeteer',
  'selenium-webdriver',
  '@orbit/executor-playwright',
  '@orbit/executor-x3270',
  '@orbit/executor-http',
  '@orbit/credentials',
  '@orbit/execution-recorder',
];

const IMPORT_PATTERN = /(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;

function importsOf(contents: string): readonly string[] {
  return [...contents.matchAll(IMPORT_PATTERN)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

/** Every source file in the package, tests included. */
function sourceFiles(directory: string): readonly string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (entry.name.endsWith('.ts')) {
      found.push(path);
    }
  }

  return found;
}

describe('the runtime cannot reach an executor implementation', () => {
  const files = sourceFiles(SOURCE_ROOT);

  it('has sources to scan', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('imports no execution engine anywhere, test files included', () => {
    // Test files are scanned too, deliberately. The runtime's tests drive fakes
    // from `./testing/fakes`, never a real engine: a test that launched Chromium
    // would make this package depend on it in practice while leaving the
    // production import graph looking clean.
    const offences: string[] = [];

    for (const file of files) {
      for (const specifier of importsOf(readFileSync(file, 'utf8'))) {
        if (
          FORBIDDEN.some((banned) => specifier === banned || specifier.startsWith(banned)) &&
          // This file names them in order to ban them.
          !file.endsWith('executor-boundary.test.ts')
        ) {
          offences.push(`${file.replace(SOURCE_ROOT, '')} imports "${specifier}"`);
        }
      }
    }

    expect(offences).toEqual([]);
  });

  it('declares no execution engine as a dependency either', () => {
    // Structural rather than incidental: what it cannot resolve, it cannot
    // import later by accident.
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
      readonly dependencies?: Readonly<Record<string, string>>;
      readonly devDependencies?: Readonly<Record<string, string>>;
    };

    const declared = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ];

    for (const banned of FORBIDDEN) {
      expect(declared.filter((name) => name.startsWith(banned))).toEqual([]);
    }
  });

  it('reaches no engine transitively through the packages it does depend on', () => {
    // The runtime depends on @orbit/db, @orbit/agent-ir and others. If any of
    // those grew an engine dependency, the runtime would gain one without a
    // single line of this package changing — so the whole workspace closure is
    // walked rather than only the direct list.
    const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));
    const seen = new Set<string>();
    const offences: string[] = [];

    function walk(packageName: string): void {
      if (seen.has(packageName)) {
        return;
      }
      seen.add(packageName);

      const directory = join(workspaceRoot, 'packages', packageName.replace('@orbit/', ''));
      let manifest: { readonly dependencies?: Readonly<Record<string, string>> };

      try {
        manifest = JSON.parse(
          readFileSync(join(directory, 'package.json'), 'utf8'),
        ) as typeof manifest;
      } catch {
        return; // Not a workspace package under packages/; nothing to walk.
      }

      for (const dependency of Object.keys(manifest.dependencies ?? {})) {
        if (FORBIDDEN.some((banned) => dependency.startsWith(banned))) {
          offences.push(`${packageName} depends on "${dependency}"`);
        }

        if (dependency.startsWith('@orbit/')) {
          walk(dependency);
        }
      }
    }

    walk('@orbit/runtime');

    expect(offences).toEqual([]);
  });
});
