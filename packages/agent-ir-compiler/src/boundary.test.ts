import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Compiling is arithmetic on reviewed data, not an action.
 *
 * It reads a graph and its mappings and returns a candidate. Reaching a
 * browser, a connection pool, a model or the network from here would mean the
 * compiler could do something other than compile — and the thing it produces is
 * the document that later becomes a runnable agent, so it is precisely where a
 * capability must not be able to hide.
 *
 * `@orbit/db/checksum` is the one deliberate exception, and it is not a
 * loophole: that subpath carries `node:crypto` and a type import, so importing
 * it gets a hash function rather than a database. The test below proves that by
 * reading the file rather than by asserting it in a comment.
 */
const SOURCE_ROOT = fileURLToPath(new URL('.', import.meta.url));

const FORBIDDEN_PACKAGES = [
  '@orbit/runtime',
  '@orbit/executor-playwright',
  '@orbit/execution-recorder',
  '@orbit/sop-service',
  '@orbit/artifacts',
  'playwright',
  'playwright-core',
  'drizzle-orm',
  'pg',
];

/** Capabilities that need no import at all, so an import rule cannot see them. */
const FORBIDDEN_SOURCE = [
  'fetch(',
  'XMLHttpRequest',
  'chromium',
  'page.',
  'node:net',
  'node:http',
  'node:dns',
  'node:fs',
  'child_process',
];

const IMPORT_PATTERN = /(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;

function importsOf(file: string): readonly string[] {
  return [...readFileSync(file, 'utf8').matchAll(IMPORT_PATTERN)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

function productionFiles(directory: string): readonly string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...productionFiles(path));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      found.push(path);
    }
  }

  return found;
}

describe('the compiler cannot act on anything', () => {
  const files = productionFiles(SOURCE_ROOT);

  it('has source to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('imports nothing that could open a browser, a pool, or the network', () => {
    const offences: string[] = [];

    for (const file of files) {
      for (const specifier of importsOf(file)) {
        if (
          FORBIDDEN_PACKAGES.some(
            (banned) => specifier === banned || specifier.startsWith(`${banned}/`),
          )
        ) {
          offences.push(`${file} imports "${specifier}"`);
        }
      }
    }

    expect(offences).toEqual([]);
  });

  it('contains no capability that needs no import', () => {
    const offences: string[] = [];

    for (const file of files) {
      // Comments are stripped first: this package's own documentation discusses
      // browsers and pools while explaining that it cannot reach them, and a
      // scan that punished writing that down would encourage leaving the
      // boundary unexplained.
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

      for (const banned of FORBIDDEN_SOURCE) {
        if (code.includes(banned)) {
          offences.push(`${file} contains "${banned}"`);
        }
      }
    }

    expect(offences).toEqual([]);
  });

  it('gets a hash function from @orbit/db/checksum, not a database', () => {
    // The one allowed @orbit/db import. Asserted structurally rather than
    // trusted: if that file ever grows a pool, this fails.
    const checksum = fileURLToPath(new URL('../../db/src/checksum.ts', import.meta.url));

    expect(existsSync(checksum)).toBe(true);

    const imports = importsOf(checksum);
    expect(imports).toContain('node:crypto');

    for (const specifier of imports) {
      expect(['node:crypto', '@orbit/sop-graph']).toContain(specifier);
    }
  });

  it('detects a violation rather than passing vacuously', () => {
    // The scan is only worth having if it can fail.
    const banned = FORBIDDEN_PACKAGES.filter((entry) => entry === 'playwright');
    expect(banned).toEqual(['playwright']);
    expect(importsOf(join(SOURCE_ROOT, 'compile.ts'))).toContain('@orbit/db/checksum');
  });
});
