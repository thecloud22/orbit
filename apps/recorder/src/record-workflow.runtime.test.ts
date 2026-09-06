import { createDatabase, createRepositories, type OrbitDatabase } from '@orbit/db';
import { loadTestEnv, resolveTestDatabaseUrl, truncateOrbitTables } from '@orbit/db/testing';
import { databaseNameFromUrl } from '@orbit/db';
import {
  openRecordingSession,
  type RecordingSession,
  type SequenceEntry,
} from '@orbit/execution-recorder';
import { createSopRecordingService, type RecordedEntry } from '@orbit/sop-service';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * A real recording, against a real page, becoming a real document.
 *
 * Everything below the browser is unit-tested without one; what this proves is
 * the part that can only be proven by doing it — that what a person's clicks
 * produce is a workflow the rest of Orbit accepts without knowing it was
 * recorded.
 */
const DEMO_PORTAL_URL = 'http://localhost:3001/requests';

let database: { readonly db: OrbitDatabase; close(): Promise<void> } | undefined;
let session: RecordingSession | undefined;

beforeAll(async () => {
  loadTestEnv();
  const url = resolveTestDatabaseUrl();
  const handle = createDatabase({ url, maxConnections: 2 });
  await truncateOrbitTables(handle.db, databaseNameFromUrl(url));
  database = handle;
}, 60_000);

afterAll(async () => {
  await database?.close();
  database = undefined;
});

afterEach(async () => {
  await session?.close();
  session = undefined;
});

/** Maps the recorder's sequence the way the CLI does. */
function toRecordedEntries(sequence: readonly SequenceEntry[]): readonly RecordedEntry[] {
  const entries: RecordedEntry[] = [];

  for (const entry of sequence) {
    if (entry.type === 'navigate') {
      entries.push({ kind: 'navigate', url: entry.url });
    } else if (entry.type !== 'pick') {
      entries.push({
        kind: entry.type,
        selectors: entry.selectors,
        fingerprint: entry.fingerprint,
        ...(entry.typedValue === undefined ? {} : { typedValue: entry.typedValue }),
        ...(entry.sensitive ? { sensitive: true } : {}),
      });
    }
  }

  return entries;
}

describe('recording a workflow end to end', () => {
  it('turns a performed task into a document with approved bindings', async () => {
    const active = await openRecordingSession({
      startUrl: DEMO_PORTAL_URL,
      mode: 'action',
      headless: true,
    });
    session = active;

    // The "human": fill the request number and run the search, for real.
    await active.page().getByTestId('request-number-input').fill('SR-1001');
    await active.page().getByTestId('search-request-button').click();
    await active.page().getByTestId('request-result').waitFor({ state: 'visible' });

    await expect
      .poll(() => active.sequence().length, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(3);

    const sequence = active.sequence();

    // The navigation is in the sequence, not just the clicks.
    expect(sequence[0]?.type).toBe('navigate');
    expect(sequence.map((entry) => entry.type)).toContain('fill');
    expect(sequence.map((entry) => entry.type)).toContain('click');

    const result = await createSopRecordingService({
      database: database!.db,
    }).createFromRecording({
      title: 'Find a service request',
      startUrl: DEMO_PORTAL_URL,
      sequence: toRecordedEntries(sequence),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // A workflow the rest of Orbit accepts: it validates, it ends on a
    // terminal, and its bindings are approved.
    expect(result.revision.graph.steps.at(0)?.kind).toBe('navigate');
    expect(result.revision.graph.steps.at(-1)?.kind).toBe('outcome');
    expect(result.bindings.length).toBeGreaterThanOrEqual(2);
    expect(result.bindings.every((binding) => binding.state === 'approved')).toBe(true);

    // And the selectors were verified against the real page at capture time,
    // so they are the ones the drift check will later resolve.
    const clickBinding = result.bindings.find((binding) => binding.binding.body.kind === 'click');
    expect(clickBinding?.binding.body.target.selectors[0]).toEqual({
      strategy: 'test_id',
      value: 'search-request-button',
    });
    expect(clickBinding?.binding.body.target.fingerprint.accessibleName).toBe('Search');
  }, 90_000);

  it('appears in the documents list and opens in review, like any other document', async () => {
    const repositories = createRepositories(database!.db);
    const documents = await repositories.sopDocuments.list();

    expect(documents.length).toBeGreaterThan(0);

    const summary = await repositories.sopDocuments.summarize(documents[0]!.id);

    // The 4d list reads this; the 2.3 review page reads the revision. Neither
    // knows recording exists.
    expect(summary?.stepCount).toBeGreaterThan(2);
    expect(summary?.status).toBe('draft');

    const current = await repositories.sopGraphRevisions.findCurrent(documents[0]!.id);
    expect(current?.provenance.kind).toBe('recorded');
    expect(current?.graph.title).toBe('Find a service request');
  });
});
