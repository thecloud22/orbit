import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Advice never becomes action, and only one file reaches a model.
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

describe('the execution assist boundary', () => {
  const files = sourceFiles(SOURCE_ROOT);

  it('reaches a model from exactly one file', () => {
    const importers = files.filter((file) =>
      importsOf(readFileSync(file, 'utf8')).some((specifier) =>
        specifier.startsWith('@langchain/'),
      ),
    );

    expect(importers.map((file) => file.replace(SOURCE_ROOT, ''))).toEqual([
      'anthropic-assist-provider.ts',
    ]);
  });

  it('cannot reach the runtime, the recorder, persistence, or a browser', () => {
    // Advice must not be able to act on anything it advises about. The drift
    // check's pass/fail logic in particular is 4a's, and is not this package's
    // business.
    const banned = [
      '@orbit/runtime',
      '@orbit/db',
      '@orbit/execution-recorder',
      'playwright',
      'node:fs',
    ];

    const offences: string[] = [];

    for (const file of files) {
      for (const specifier of importsOf(readFileSync(file, 'utf8'))) {
        if (banned.some((entry) => specifier === entry || specifier.startsWith(`${entry}/`))) {
          offences.push(`${file.replace(SOURCE_ROOT, '')} imports "${specifier}"`);
        }
      }
    }

    expect(offences).toEqual([]);
  });

  it('keeps the fake provider out of production code', () => {
    const offenders = files
      .filter((file) => !file.includes(join('src', 'testing')))
      .filter((file) => readFileSync(file, 'utf8').includes('createFakeAssistProvider'));

    expect(offenders.map((file) => file.replace(SOURCE_ROOT, ''))).toEqual([]);
  });
});
