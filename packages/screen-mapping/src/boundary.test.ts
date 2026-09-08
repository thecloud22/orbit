import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * @orbit/screen-mapping describes and compares. It cannot act.
 *
 * The terminal counterpart to @orbit/execution-mapping's boundary, and it
 * matters more here rather than less. A terminal address decides what gets typed
 * into a live host field, and the transport for this surface is a socket or a
 * subprocess -- both of which are a single ordinary-looking import away. Zod is
 * the entire runtime dependency surface, so there is no route to a network, a
 * process, an emulator, a database, or a model.
 *
 * This is also what let TASK-P3-000 change the transport without invalidating
 * any of this: a package that cannot reach a transport cannot be coupled to one.
 */
const SOURCE_ROOT = fileURLToPath(new URL('.', import.meta.url));

function productionSourceFiles(directory: string): readonly string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...productionSourceFiles(path));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      found.push(path);
    }
  }

  return found;
}

/** Packages this one must never import. Matched against parsed imports. */
const FORBIDDEN_IMPORTS = [
  '@orbit/db',
  '@orbit/runtime',
  '@orbit/sop-graph',
  '@orbit/executor-playwright',
  'playwright',
  'node:fs',
  'node:net',
  'node:http',
  'node:https',
  'node:dns',
  'node:child_process',
  // The terminal surface's own transports. Every one of these is what an
  // executor legitimately needs and this package must never acquire.
  'node:tls',
  'node:net/promises',
  '@orbit/executor-x3270',
  '@orbit/agent-ir',
];

/**
 * Code shapes, not words.
 *
 * Matched as calls rather than as substrings, because a doc comment explaining
 * that this package never touches a page must not be the thing that trips the
 * check enforcing it.
 */
const FORBIDDEN_CALL_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ['a browser page call', /\bpage\s*\.\s*\w+\s*\(/],
  ['chromium.launch', /\bchromium\s*\.\s*launch\s*\(/],
  ['fetch', /\bfetch\s*\(/],
  ['evaluate', /\bevaluate\s*\(/],
  ['XMLHttpRequest', /\bnew\s+XMLHttpRequest\b/],
  ['spawn', /\bspawn(?:Sync)?\s*\(/],
  ['a socket connect', /\bconnect\s*\(\s*\{/],
];

const IMPORT_PATTERN = /(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;

function importsOf(contents: string): readonly string[] {
  return [...contents.matchAll(IMPORT_PATTERN)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

describe('the execution mapping boundary', () => {
  const files = productionSourceFiles(SOURCE_ROOT).filter(
    (file) => !file.includes(`${join('src', 'testing')}`),
  );

  it('has production sources to scan', () => {
    // A guard against the scan silently finding nothing, not a size target.
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it('imports nothing that could act', () => {
    const offences: string[] = [];

    for (const file of files) {
      for (const specifier of importsOf(readFileSync(file, 'utf8'))) {
        if (
          FORBIDDEN_IMPORTS.some(
            (banned) => specifier === banned || specifier.startsWith(`${banned}/`),
          )
        ) {
          offences.push(`${file.replace(SOURCE_ROOT, '')} imports "${specifier}"`);
        }
      }
    }

    // @orbit/sop-graph is on that list on purpose: a binding is executable
    // detail and a graph is business intent, and ADR-002 keeps the two
    // representations independent in both directions.
    expect(offences).toEqual([]);
  });

  it('contains no browser, network, or script-evaluation call', () => {
    const offences: string[] = [];

    for (const file of files) {
      const contents = readFileSync(file, 'utf8');

      for (const [label, pattern] of FORBIDDEN_CALL_PATTERNS) {
        if (pattern.test(contents)) {
          offences.push(`${file.replace(SOURCE_ROOT, '')} contains ${label}`);
        }
      }
    }

    expect(offences).toEqual([]);
  });
});
