import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * One file may reach the network, and it is not the one holding the prompt.
 *
 * The same guard @orbit/sop-generation carries, for the same reason: this
 * package handles untrusted page content, and the difference between "a module
 * that formats untrusted text" and "a module that sends it somewhere" has to be
 * visible in the import graph rather than in a convention.
 *
 * It must also never reach a browser, a database, or the filesystem. The spend
 * ledger is an interface the entry point satisfies precisely so that a package
 * calling a model does not also hold a connection pool.
 */
const SOURCE_ROOT = fileURLToPath(new URL('.', import.meta.url));

/** The only module permitted to hold a model client. */
const NETWORK_MODULE = 'anthropic-model.ts';

const FORBIDDEN_IMPORTS = [
  'playwright',
  'playwright-core',
  '@orbit/db',
  '@orbit/execution-recorder',
  'node:fs',
  'node:net',
  'node:http',
  'node:https',
  'node:dns',
  'node:child_process',
];

const IMPORT_PATTERN = /(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;

function importsOf(contents: string): readonly string[] {
  return [...contents.matchAll(IMPORT_PATTERN)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

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

describe('the decision judge network boundary', () => {
  const files = productionSourceFiles(SOURCE_ROOT);

  it('has production sources to scan', () => {
    expect(files.length).toBeGreaterThan(2);
  });

  it('confines the model client to one module', () => {
    const offences: string[] = [];

    for (const file of files) {
      if (file.endsWith(NETWORK_MODULE)) {
        continue;
      }

      for (const specifier of importsOf(readFileSync(file, 'utf8'))) {
        if (specifier.startsWith('@langchain/') || specifier.startsWith('@anthropic-ai/')) {
          offences.push(`${file.replace(SOURCE_ROOT, '')} imports "${specifier}"`);
        }
      }
    }

    expect(offences).toEqual([]);
  });

  it('reaches no browser, database, or filesystem anywhere', () => {
    const offences: string[] = [];

    for (const file of files) {
      for (const specifier of importsOf(readFileSync(file, 'utf8'))) {
        if (
          FORBIDDEN_IMPORTS.some((banned) => specifier === banned || specifier.startsWith(banned))
        ) {
          offences.push(`${file.replace(SOURCE_ROOT, '')} imports "${specifier}"`);
        }
      }
    }

    expect(offences).toEqual([]);
  });
});
