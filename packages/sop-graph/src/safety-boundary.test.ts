import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import * as sopGraphExports from './index';
import { parseSopGraphDocument } from './parse';
import { validateReorder } from './reorder';
import { escalationReviewGraph } from './testing/fixtures';
import { validateSopGraph } from './validate';

/**
 * Proves @orbit/sop-graph cannot execute anything.
 *
 * Three angles: the source contains none of the vocabulary an executor would
 * need (static scan); calling the public API never reaches the network, even
 * when the graph carries real-looking URLs (runtime proof); and the package
 * exports nothing shaped like something that runs, navigates, or publishes.
 */

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

const FORBIDDEN_SUBSTRINGS = [
  'fetch(',
  'XMLHttpRequest',
  'chromium',
  'playwright',
  'page.',
  'node:net',
  'node:http',
  'node:dns',
  'child_process',
  '@orbit/agent-ir',
  '@orbit/runtime',
  '@orbit/db',
  '@orbit/executor-playwright',

  // ADR-016 warned this denylist "will need extending if a new execution surface
  // appears", and ADR-037 is where they start appearing. `node:net` and
  // `child_process` above already cover a terminal surface's mechanism; these
  // name the rest of the vocabulary a non-browser executor would need. An entry
  // for a package that does not exist yet is inert, which is the point -- it
  // fails the moment someone adds one, rather than being remembered then.
  'node:tls',
  'undici',
  '3270',
  '@orbit/executor-x3270',
  '@orbit/executor-http',
] as const;

function listNonTestTsFiles(dir: string): readonly string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...listNonTestTsFiles(full));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(full);
    }
  }

  return files;
}

describe('safety boundary: static scan', () => {
  it('contains none of the browser, network, or execution-adjacent vocabulary', () => {
    const files = listNonTestTsFiles(SRC_DIR);
    // Sanity check that the scan actually looked at something.
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, 'utf8');

      for (const forbidden of FORBIDDEN_SUBSTRINGS) {
        if (content.includes(forbidden)) {
          violations.push(`${file}: contains "${forbidden}"`);
        }
      }
    }

    expect(violations, violations.join('\n')).toEqual([]);
  });
});

describe('safety boundary: runtime proof', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('never touches the network while parsing, validating, or reordering', () => {
    let callCount = 0;
    globalThis.fetch = (() => {
      callCount += 1;
      throw new Error('network access attempted');
    }) as typeof fetch;

    // Real-looking URLs on the navigate steps make this a meaningful proof,
    // not a vacuous one.
    const graph = escalationReviewGraph();

    expect(() => parseSopGraphDocument(graph)).not.toThrow();
    expect(() => validateSopGraph(graph)).not.toThrow();

    const toIndex = graph.steps.findIndex((step) => step.id === 'enter_date_to');
    expect(() => validateReorder(graph, { stepId: 'enter_date_from', toIndex })).not.toThrow();

    expect(callCount).toBe(0);
  });
});

describe('safety boundary: exports', () => {
  /**
   * The package may describe an action; it may not perform one.
   *
   * The test is on *callables*, not names. `navigateStepSchema` is a Zod schema
   * for the shape of a navigate step — describing what a navigation would be is
   * the entire job of this package, and a schema cannot do anything. What must
   * never appear is an exported function named like an action, because that is
   * what a caller could invoke.
   */
  it('exports no callable named like something that executes', () => {
    const callable = Object.entries(sopGraphExports)
      .filter(([, value]) => typeof value === 'function')
      .filter(([name]) => /^(run|execute|navigate|fetch|launch|publish|open|send)/i.test(name))
      .map(([name]) => name);

    expect(callable).toEqual([]);
  });

  it('exports the schema named for the navigate step, which is a value and not a function', () => {
    const schema = (sopGraphExports as Record<string, unknown>)['navigateStepSchema'];

    expect(schema).toBeDefined();
    expect(typeof schema).not.toBe('function');
  });
});
