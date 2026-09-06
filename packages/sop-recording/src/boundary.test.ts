import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Translation is arithmetic on captured data.
 *
 * It takes a sequence and returns a document — no browser, no database, no
 * model. That is what lets a fixed recording be checked against an exact
 * expected graph with nothing running, and it is what keeps the step that
 * decides *what a workflow says* separate from the ones that can act on it.
 */
const SOURCE_ROOT = fileURLToPath(new URL('.', import.meta.url));

function sourceFiles(directory: string): readonly string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      found.push(path);
    }
  }

  return found;
}

const IMPORT_PATTERN = /(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;

function importsOf(contents: string): readonly string[] {
  return [...contents.matchAll(IMPORT_PATTERN)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

describe('the recording translation boundary', () => {
  const files = sourceFiles(SOURCE_ROOT);

  it('imports nothing that could act', () => {
    const banned = [
      '@orbit/db',
      '@orbit/runtime',
      '@orbit/execution-recorder',
      '@orbit/sop-service',
      'playwright',
      '@langchain/',
      'node:fs',
    ];

    const offences: string[] = [];

    for (const file of files) {
      for (const specifier of importsOf(readFileSync(file, 'utf8'))) {
        if (banned.some((entry) => specifier === entry || specifier.startsWith(entry))) {
          offences.push(`${file.replace(SOURCE_ROOT, '')} imports "${specifier}"`);
        }
      }
    }

    expect(offences).toEqual([]);
  });

  it('contains no browser, network, or script-evaluation call', () => {
    const patterns: readonly (readonly [string, RegExp])[] = [
      ['a browser page call', /\bpage\s*\.\s*\w+\s*\(/],
      ['fetch', /\bfetch\s*\(/],
      ['evaluate', /\bevaluate\s*\(/],
    ];

    const offences: string[] = [];

    for (const file of files) {
      const contents = readFileSync(file, 'utf8');
      for (const [label, pattern] of patterns) {
        if (pattern.test(contents)) {
          offences.push(`${file.replace(SOURCE_ROOT, '')} contains ${label}`);
        }
      }
    }

    expect(offences).toEqual([]);
  });
});
