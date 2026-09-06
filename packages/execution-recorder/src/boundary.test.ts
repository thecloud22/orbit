import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The trust boundary sub-phase 2.4 was split to isolate.
 *
 * This package injects a script into a page — a capability ADR-008 denies the
 * runtime outright. That is why it exists separately, and these are the
 * assertions that keep the separation real rather than intended.
 *
 * Two properties matter. Script injection is confined to the one file whose
 * entire job it is, so it cannot spread. And the derived selector vocabulary
 * stays 4a's closed set, so a recording can never produce a CSS or XPath
 * selector no matter what a page reports.
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

describe('the execution recorder boundary', () => {
  const files = sourceFiles(SOURCE_ROOT);

  it('has production sources to scan', () => {
    expect(files.length).toBeGreaterThan(2);
  });

  it('builds page script in exactly one file', () => {
    // `injected.ts` is the whole of Orbit's script-injection surface. Confining
    // it means "how much code runs inside a page?" has a one-file answer.
    const authors = files.filter((file) =>
      /document\.addEventListener|window\.__orbit/.test(readFileSync(file, 'utf8')),
    );

    expect(authors.map((file) => file.replace(SOURCE_ROOT, ''))).toEqual(['injected.ts']);
  });

  it('uses a raw selector only to find the element it just marked', () => {
    // A CSS attribute lookup is unavoidable for a token this process stamped
    // microseconds earlier. It is not a hole in the closed vocabulary: it is
    // one function, and nothing it returns can reach a binding.
    const users = files.filter((file) => /page\.locator\(/.test(readFileSync(file, 'utf8')));

    expect(users.map((file) => file.replace(SOURCE_ROOT, ''))).toEqual(['derive.ts']);
    expect(
      readFileSync(join(SOURCE_ROOT, 'derive.ts'), 'utf8').match(/page\.locator\(/g),
    ).toHaveLength(1);
  });

  it('can never derive a CSS or XPath selector for a binding', () => {
    // The strategies it emits are 4a's three and nothing else.
    const derive = readFileSync(join(SOURCE_ROOT, 'derive.ts'), 'utf8');
    const emitted = [...derive.matchAll(/strategy:\s*'([a-z_]+)'/g)].map((match) => match[1]);

    expect([...new Set(emitted)].sort()).toEqual(['label', 'role_and_name', 'test_id']);
  });

  it('has no database, no model, and no knowledge of the SOP Graph', () => {
    const banned = ['@orbit/db', '@langchain/', '@orbit/sop-graph', '@orbit/runtime', 'node:fs'];
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
});
