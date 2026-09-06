import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The boundary, extended to the composition root.
 *
 * Task 2's automated scan covered `@orbit/sop-generation` only; this package
 * was checked by hand. Sub-phase 2.3 adds code here that handles step content a
 * person just typed — `urlHint` and `systemHint` among it — so the same guard
 * now applies to every file in it. There is no exception because the content is
 * "just an edit": an edited URL is exactly as untrusted as a generated one.
 *
 * This package legitimately reaches PostgreSQL. What it must never do is reach
 * a network itself, or a browser, or the filesystem.
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

const FORBIDDEN_TOKENS = [
  'chromium',
  'playwright',
  'page.',
  'XMLHttpRequest',
  'child_process',
  'node:net',
  'node:http',
  'node:dns',
  'node:fs',
  '@langchain/',
];

describe('the SOP service network boundary', () => {
  const files = productionSourceFiles(SOURCE_ROOT);

  it('has production sources to scan', () => {
    expect(files.length).toBeGreaterThan(2);
  });

  it('contains no browser, filesystem, transport, or model-client surface', () => {
    const offences: string[] = [];

    for (const file of files) {
      const contents = readFileSync(file, 'utf8');

      for (const token of FORBIDDEN_TOKENS) {
        if (contents.includes(token)) {
          offences.push(`${file.replace(SOURCE_ROOT, '')} contains "${token}"`);
        }
      }
    }

    // The model client belongs to @orbit/sop-generation and is reached through
    // the LLMProvider interface; this package composes, it does not call out.
    expect(offences).toEqual([]);
  });

  it('never calls fetch itself', () => {
    const callers = files.filter((file) => /\bfetch\s*\(/.test(readFileSync(file, 'utf8')));
    expect(callers.map((file) => file.replace(SOURCE_ROOT, ''))).toEqual([]);
  });
});
