import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { generateSopGraph } from './generate';
import { createFakeSopProvider, respondWith, validSopGraphProposal } from './testing';

/**
 * The boundary this package must respect.
 *
 * Sub-phase 2.2 legitimately calls the network — to the configured model
 * provider. That is a different thing from contacting a URL that appears
 * *inside* a graph, which stays forbidden: `urlHint` and `systemHint` are
 * untrusted draft references all the way through generation and persistence
 * (ADR-016), and become a policy question only in sub-phase 2.4.
 *
 * Two guards, and they fail differently. The scan reads text and would catch a
 * dynamic import or a stray global that no import rule sees; the spy observes
 * behaviour and is the one that would still fail if the scan were weakened.
 */

const SOURCE_ROOT = fileURLToPath(new URL('.', import.meta.url));

/** Production sources only. A test file legitimately contains these as data. */
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
  'firefox.launch',
  'webkit.launch',
  'playwright',
  'page.',
  'XMLHttpRequest',
  'child_process',
  'node:net',
  'node:http',
  'node:dns',
  'node:fs',
];

describe('the SOP generation network boundary', () => {
  const files = productionSourceFiles(SOURCE_ROOT);

  it('has production sources to scan', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('contains no browser, filesystem, or raw-transport surface', () => {
    const offences: string[] = [];

    for (const file of files) {
      const contents = readFileSync(file, 'utf8');

      for (const token of FORBIDDEN_TOKENS) {
        if (contents.includes(token)) {
          offences.push(`${file.replace(SOURCE_ROOT, '')} contains "${token}"`);
        }
      }
    }

    expect(offences).toEqual([]);
  });

  it('reaches the model provider from the provider modules and nowhere else', () => {
    // The point of this assertion is containment, not tidiness: if the provider
    // client spreads across the package, "which code can talk to the network?"
    // stops having a short answer. It is two files rather than one now, and the
    // list is exhaustive on purpose — a third provider must be added here
    // deliberately, and the shared response reader stays on the near side of
    // the boundary because it imports no client at all.
    const importers = files.filter((file) => readFileSync(file, 'utf8').includes('@langchain/'));

    expect(importers.map((file) => file.replace(SOURCE_ROOT, '')).sort()).toEqual([
      'anthropic-provider.ts',
      'bedrock-provider.ts',
    ]);
  });

  it('never calls fetch itself', () => {
    const callers = files.filter((file) => /\bfetch\s*\(/.test(readFileSync(file, 'utf8')));

    expect(callers.map((file) => file.replace(SOURCE_ROOT, ''))).toEqual([]);
  });

  it('does not contact a URL that came out of a graph', async () => {
    const original = globalThis.fetch;
    const calls: string[] = [];

    globalThis.fetch = ((input: unknown) => {
      calls.push(String(input));
      throw new Error('The SOP generation pipeline must never fetch anything.');
    }) as typeof globalThis.fetch;

    try {
      const provider = createFakeSopProvider({
        respond: () => respondWith(validSopGraphProposal()),
      });

      const result = await generateSopGraph({
        provider,
        sourceText: 'Open the portal at https://service-portal.example.com/login and sign in.',
      });

      expect(result.ok).toBe(true);

      // The URLs survive into the graph as text, which is the point: they are
      // carried, reviewed, and never contacted.
      const hints = result.ok
        ? result.graph.steps.flatMap((step) =>
            step.kind === 'navigate' && step.urlHint !== undefined ? [step.urlHint] : [],
          )
        : [];

      expect(hints).toContain('https://service-portal.example.com/login');
      expect(calls).toEqual([]);
    } finally {
      globalThis.fetch = original;
    }
  });
});
