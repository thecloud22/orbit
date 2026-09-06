import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

import { createDatabase, requireDatabaseUrl } from '@orbit/db';
import { openRecordingSession, type SequenceEntry } from '@orbit/execution-recorder';
import { createSopRecordingService, type RecordedEntry } from '@orbit/sop-service';

import { decideStartUrl } from '../flow';
import { loadRootEnv } from './env';

/**
 * `pnpm record:workflow -- --title "Find a request" --start-url http://localhost:3001/requests`
 *
 * Perform a task once in a real browser and it becomes a workflow: steps and
 * their bindings together, because both describe the same interaction.
 *
 * The difference from `record:binding` is where the confirmation sits. That
 * command maps one already-known step at a time and confirms each; this one
 * captures a whole sequence and confirms once at the end, because the person
 * is discovering the workflow by doing it rather than transcribing one they
 * already wrote down.
 *
 * What it produces is a linear draft. A single recording walks one path, so it
 * cannot honestly produce a branch nobody took — decisions are added afterwards
 * on the review page, the same as for any first draft.
 */

const USAGE = `
Usage: pnpm record:workflow -- --title <title> [options]

  --title <title>     Required. What the workflow is called.
  --start-url <url>   Where to open the browser. Localhost only.
  --headless          For debugging only; you cannot perform what you cannot see.
  --help              Show this message.
`;

// `pnpm record:workflow -- --flag` forwards the `--` separator itself, which
// parseArgs would read as "everything after this is positional".
const argv = process.argv.slice(2);
const args = argv[0] === '--' ? argv.slice(1) : argv;

/**
 * The recorder's sequence, as the translator needs it.
 *
 * A `pick` is dropped: it means someone pointed at a value to read, which
 * belongs to mapping an existing step rather than to performing a task.
 */
function toRecordedEntries(sequence: readonly SequenceEntry[]): readonly RecordedEntry[] {
  const entries: RecordedEntry[] = [];

  for (const entry of sequence) {
    if (entry.type === 'navigate') {
      entries.push({ kind: 'navigate', url: entry.url });
      continue;
    }

    if (entry.type === 'pick') {
      continue;
    }

    entries.push({
      kind: entry.type,
      selectors: entry.selectors,
      fingerprint: entry.fingerprint,
      ...(entry.typedValue === undefined ? {} : { typedValue: entry.typedValue }),
      ...(entry.sensitive ? { sensitive: true } : {}),
    });
  }

  return entries;
}

function describeEntry(entry: SequenceEntry): string {
  if (entry.type === 'navigate') {
    return `went to ${entry.url}`;
  }

  const named = entry.fingerprint.accessibleName ?? entry.fingerprint.text ?? '(unnamed)';
  return entry.type === 'fill'
    ? `filled "${named}"${entry.sensitive ? ' (password — value not read)' : ''}`
    : `clicked "${named}"`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      title: { type: 'string' },
      'start-url': { type: 'string' },
      headless: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

  if (values.help === true || values.title === undefined) {
    process.stdout.write(USAGE);
    process.exit(values.help === true ? 0 : 1);
  }

  const decision = decideStartUrl(values['start-url'] ?? 'http://localhost:3001/requests');

  if (!decision.ok) {
    process.stderr.write(`${decision.reason}\n`);
    process.exit(1);
  }

  loadRootEnv();

  const handle = createDatabase({ url: requireDatabaseUrl('DATABASE_URL') });
  const io = createInterface({ input: process.stdin, output: process.stdout });

  try {
    process.stdout.write('\nOpening the browser. Perform the task, then come back here.\n');

    const session = await openRecordingSession({
      startUrl: decision.url,
      mode: 'action',
      headless: values.headless === true,
    });

    try {
      await io.question('\nPress Enter when you have finished the task. ');

      const sequence = session.sequence();

      if (sequence.length === 0) {
        process.stdout.write('\nNothing was captured, so there is no workflow to save.\n');
        return;
      }

      process.stdout.write('\nWhat you did:\n');
      sequence.forEach((entry, index) => {
        process.stdout.write(`  ${index + 1}. ${describeEntry(entry)}\n`);
      });

      const confirmed = (await io.question('\nSave this as a workflow? [y/N] '))
        .trim()
        .toLowerCase();

      if (confirmed !== 'y') {
        process.stdout.write('Discarded. Nothing was saved.\n');
        return;
      }

      const result = await createSopRecordingService({ database: handle.db }).createFromRecording({
        title: values.title,
        startUrl: decision.url,
        sequence: toRecordedEntries(sequence),
      });

      if (!result.ok) {
        process.stdout.write(
          `\nThat recording could not become a workflow:\n${result.issues
            .map((issue: { code: string; message: string }) => `  [${issue.code}] ${issue.message}`)
            .join('\n')}\n`,
        );
        process.exitCode = 1;
        return;
      }

      process.stdout.write(
        `\nSaved ${result.document.id} — ${result.revision.graph.steps.length} steps, ` +
          `${result.bindings.length} approved bindings.\n` +
          `Review it in Watchtower: /?documentId=${result.document.id}\n`,
      );
    } finally {
      await session.close();
    }
  } finally {
    io.close();
    await handle.close();
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
}
