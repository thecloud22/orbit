import { createRepositories } from '@orbit/db';
import { useTestDatabase } from '@orbit/db/testing';
import { minimalGraph } from '@orbit/sop-graph/testing';
import { describe, expect, it } from 'vitest';

import { createSopDiscardService } from './discard-service';

/**
 * Discarding a workflow, against real persistence.
 *
 * The two properties worth pinning are both about what discarding does *not*
 * do: it does not delete the row, and it does not touch a workflow whose
 * versions are running.
 */

async function draftDocument(database: Parameters<typeof createRepositories>[0], title: string) {
  const repositories = createRepositories(database);
  const document = await repositories.sopDocuments.create({
    title,
    sourceText: 'Open the page and read what it says.',
  });

  await repositories.sopGraphRevisions.create({
    documentId: document.id,
    graph: minimalGraph(),
    provenance: { kind: 'authored' },
  });

  return document.id;
}

describe('discarding a workflow', () => {
  const getDatabase = useTestDatabase();

  it('takes it out of the list without deleting anything', async () => {
    const database = getDatabase().db;
    const repositories = createRepositories(database);
    const documentId = await draftDocument(database, 'An abandoned attempt');

    const result = await createSopDiscardService({ database }).discard(documentId);

    expect(result.ok).toBe(true);

    // Gone from the list...
    const listed = await repositories.sopDocuments.list();
    expect(listed.map((document) => document.id)).not.toContain(documentId);

    // ...and still there, with its revision, for anyone holding a link. This is
    // the whole difference between discarding and deleting: a binding and a
    // revision point at this row, and "what was this written from?" has to stay
    // answerable.
    const found = await repositories.sopDocuments.findById(documentId);
    expect(found?.discardedAt).toBeInstanceOf(Date);
    expect(await repositories.sopGraphRevisions.findCurrent(documentId)).not.toBeNull();
  });

  it('leaves every other workflow in the list alone', async () => {
    const database = getDatabase().db;
    const kept = await draftDocument(database, 'The one being worked on');
    const discarded = await draftDocument(database, 'The other one');

    await createSopDiscardService({ database }).discard(discarded);

    const listed = await createRepositories(database).sopDocuments.list();
    expect(listed.map((document) => document.id)).toEqual([kept]);
  });

  it('reports a second attempt rather than pretending it did something', async () => {
    const database = getDatabase().db;
    const documentId = await draftDocument(database, 'Discarded twice');
    const service = createSopDiscardService({ database });

    await service.discard(documentId);
    const again = await service.discard(documentId);

    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.reason).toBe('already_discarded');
  });

  it('reports a document that never existed', async () => {
    const database = getDatabase().db;
    const documentId = await draftDocument(database, 'A real one');

    const result = await createSopDiscardService({ database }).discard(
      documentId.replace(/.$/, 'Z') as never,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not_found');
  });
});
