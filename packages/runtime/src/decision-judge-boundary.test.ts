import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The runtime judges nothing itself.
 *
 * `model.decide` gave the process that executes approved steps a reason to want
 * a model client, and this is the guard that says it may not have one. What the
 * runtime holds is `DecisionJudge` — a one-method interface returning an index
 * into a closed list — and the implementation is injected by
 * `apps/browser-worker`, exactly as @orbit/executor-playwright is injected
 * behind `BrowserExecutor`.
 *
 * The distinction is not stylistic. ADR-008 denies the runtime broad capability
 * on purpose; a model client here would mean the executor could call a model
 * for any reason it liked, with a free-text channel in both directions. The
 * interface cannot be repurposed that way, and this test is what keeps the
 * claim true rather than merely intended.
 *
 * Mirrors `apps/browser-worker/src/recording-boundary.test.ts`, which makes the
 * same kind of structural argument about the recording write path.
 */
const SOURCE_ROOT = fileURLToPath(new URL('.', import.meta.url));
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Model providers, and the one Orbit package that holds one.
 *
 * @orbit/decision-judge is on the list precisely because it is Orbit's own: it
 * is where the judge implementation lives, so an import of it from here would
 * be the exact mistake this test exists to catch, and it would look entirely
 * reasonable in a diff.
 */
const FORBIDDEN = [
  '@anthropic-ai/',
  '@aws-sdk/',
  '@langchain/',
  'langchain',
  'openai',
  '@orbit/decision-judge',
  '@orbit/sop-generation',
  /**
   * The shared selection layer, on the list for the strongest reason of all.
   *
   * ADR-034 put every model client behind @orbit/model-provider. That makes it
   * a single, convenient, entirely reasonable-looking import — which is exactly
   * why the runtime must not be able to reach it. One line here would give the
   * process that executes approved steps the ability to call any model for any
   * reason, and no other test would notice.
   */
  '@orbit/model-provider',
  /**
   * Recovery's implementation, on the list for exactly the same reason.
   *
   * ADR-033 gave the runtime a second reason to want capability it should not
   * have: at the moment of drift it holds the live page and the approved
   * fingerprint, and it would be very natural to also let it decide what the
   * difference means. It does not. It gathers an observation and hands it to
   * `RecoveryProposer`; @orbit/drift-recovery diagnoses, and @orbit/execution-assist
   * is where a ranker would attach — neither is reachable from here.
   */
  '@orbit/drift-recovery',
  '@orbit/execution-assist',
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

describe('the runtime cannot reach a model provider', () => {
  const files = sourceFiles(SOURCE_ROOT);

  it('has sources to scan', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('imports no model provider anywhere, test files included', () => {
    // Test files are scanned too, deliberately. A test that reached a real
    // provider would make this package depend on one in practice while leaving
    // the production import graph looking clean — and it would also be a test
    // that spends money, which no test in this repository does.
    const offences: string[] = [];

    for (const file of files) {
      for (const specifier of importsOf(readFileSync(file, 'utf8'))) {
        if (
          FORBIDDEN.some((banned) => specifier === banned || specifier.startsWith(banned)) &&
          // This file names them in order to ban them.
          !file.endsWith('decision-judge-boundary.test.ts')
        ) {
          offences.push(`${file.replace(SOURCE_ROOT, '')} imports "${specifier}"`);
        }
      }
    }

    expect(offences).toEqual([]);
  });

  it('declares no model provider as a dependency either', () => {
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

  it('reaches no provider transitively through the packages it does depend on', () => {
    // The runtime depends on @orbit/db, @orbit/agent-ir and others. If any of
    // those grew a provider dependency, the runtime would gain one without a
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
