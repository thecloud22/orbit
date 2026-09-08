import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * What this package may reach, and what it may not.
 *
 * Recovery is the place a model is most obviously *useful* and most obviously
 * dangerous: ranking lookalike elements is exactly what a model is good at, and
 * a wrong answer here becomes a proposal a busy person accepts. v1 makes no
 * model call, and this is the guard on that claim rather than a note about it.
 *
 * The package legitimately reaches PostgreSQL, from `store.ts` alone, to insert
 * one row. It never reaches a browser and never reaches a network.
 */
const SOURCE_ROOT = fileURLToPath(new URL('.', import.meta.url));

const FORBIDDEN_IMPORTS = [
  '@anthropic-ai/',
  '@langchain/',
  'langchain',
  'openai',
  'playwright',
  'playwright-core',
  '@orbit/executor-playwright',
  '@orbit/decision-judge',
  '@orbit/sop-generation',
];

const FORBIDDEN_CALLS: readonly (readonly [string, RegExp])[] = [
  ['fetch', /\bfetch\s*\(/],
  ['a browser page call', /\bpage\s*\.\s*\w+\s*\(/],
  ['evaluate', /\bevaluate\s*\(/],
];

const IMPORT_PATTERN = /(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;

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

describe('the drift recovery boundary', () => {
  const files = sourceFiles(SOURCE_ROOT);

  it('has production sources to scan', () => {
    expect(files.length).toBeGreaterThan(2);
  });

  it('reaches no model provider and no browser', () => {
    const offences: string[] = [];

    for (const file of files) {
      const contents = readFileSync(file, 'utf8');

      for (const match of contents.matchAll(IMPORT_PATTERN)) {
        const specifier = match[1];

        if (
          specifier !== undefined &&
          FORBIDDEN_IMPORTS.some((banned) => specifier === banned || specifier.startsWith(banned))
        ) {
          offences.push(`${file.replace(SOURCE_ROOT, '')} imports "${specifier}"`);
        }
      }

      for (const [label, pattern] of FORBIDDEN_CALLS) {
        if (pattern.test(contents)) {
          offences.push(`${file.replace(SOURCE_ROOT, '')} calls ${label}`);
        }
      }
    }

    expect(offences).toEqual([]);
  });

  it('keeps the database out of the reasoning', () => {
    // `diagnose.ts` and `proposer.ts` decide what a drift means. Neither may
    // reach persistence, which is what keeps the whole decision testable with
    // no database and reviewable without one either.
    for (const name of ['diagnose.ts', 'proposer.ts']) {
      const contents = readFileSync(join(SOURCE_ROOT, name), 'utf8');
      expect(contents).not.toContain('@orbit/db');
    }
  });
});
