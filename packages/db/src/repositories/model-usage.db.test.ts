import { newModelRequestId, newSopDocumentId, type SopDocumentId } from '@orbit/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import { createRepositories } from './index';
import { useTestDatabase } from '../testing/harness';

/**
 * The model-spend ledger.
 *
 * What matters here is that the ledger is the only record: every scope is a sum
 * over these rows, so a budget and the number a person is shown cannot disagree.
 * The other claim is attribution — a brand-new document's first call happens
 * before the document exists, and adopting those rows afterwards is what makes
 * per-document spend answerable at all.
 */
describe('model usage', () => {
  const getDatabase = useTestDatabase();
  let documentId: SopDocumentId;

  function repositories() {
    return createRepositories(getDatabase().db);
  }

  beforeEach(async () => {
    const document = await repositories().sopDocuments.create({
      title: 'Anything',
      sourceText: 'anything at all',
    });
    documentId = document.id;
  });

  it('sums tokens and cost across every call', async () => {
    const requestId = newModelRequestId();

    await repositories().modelUsage.record({
      requestId,
      documentId,
      provider: 'fake',
      model: 'fake-model',
      inputTokens: 700,
      outputTokens: 300,
      estimatedCostMicroUsd: 6_600,
      attempt: 1,
    });
    await repositories().modelUsage.record({
      requestId,
      documentId,
      provider: 'fake',
      model: 'fake-model',
      inputTokens: 900,
      outputTokens: 100,
      estimatedCostMicroUsd: 4_200,
      attempt: 2,
    });

    const totals = await repositories().modelUsage.totals();

    expect(totals).toEqual({
      calls: 2,
      inputTokens: 1_600,
      outputTokens: 400,
      totalTokens: 2_000,
      estimatedCostMicroUsd: 10_800,
    });
  });

  it('keeps the three scopes apart', async () => {
    const first = newModelRequestId();
    const second = newModelRequestId();

    const other = await repositories().sopDocuments.create({
      title: 'Another',
      sourceText: 'another one',
    });

    await repositories().modelUsage.record({
      requestId: first,
      documentId,
      provider: 'fake',
      model: 'fake-model',
      inputTokens: 100,
      outputTokens: 0,
      estimatedCostMicroUsd: 300,
      attempt: 1,
    });
    await repositories().modelUsage.record({
      requestId: second,
      documentId: other.id,
      provider: 'fake',
      model: 'fake-model',
      inputTokens: 50,
      outputTokens: 0,
      estimatedCostMicroUsd: 150,
      attempt: 1,
    });

    expect((await repositories().modelUsage.totals()).totalTokens).toBe(150);
    expect((await repositories().modelUsage.totalsForDocument(documentId)).totalTokens).toBe(100);
    expect((await repositories().modelUsage.totalsForRequest(second)).totalTokens).toBe(50);
  });

  it('reports zero for a document that has spent nothing', async () => {
    const totals = await repositories().modelUsage.totalsForDocument(newSopDocumentId());

    expect(totals.calls).toBe(0);
    expect(totals.totalTokens).toBe(0);
    expect(totals.estimatedCostMicroUsd).toBe(0);
  });

  it('adopts a request’s unattributed rows into the document they made', async () => {
    const requestId = newModelRequestId();

    await repositories().modelUsage.record({
      requestId,
      provider: 'fake',
      model: 'fake-model',
      inputTokens: 400,
      outputTokens: 100,
      estimatedCostMicroUsd: 2_700,
      attempt: 1,
    });

    expect((await repositories().modelUsage.totalsForDocument(documentId)).totalTokens).toBe(0);

    const attached = await repositories().modelUsage.attachDocument(requestId, documentId);

    expect(attached).toBe(1);
    expect((await repositories().modelUsage.totalsForDocument(documentId)).totalTokens).toBe(500);
  });

  it('never moves spend from one document to another', async () => {
    // `attachDocument` only ever fills in a null. A row already attributed is
    // left exactly where it is, or the ledger would be rewritable.
    const requestId = newModelRequestId();

    await repositories().modelUsage.record({
      requestId,
      documentId,
      provider: 'fake',
      model: 'fake-model',
      inputTokens: 400,
      outputTokens: 100,
      estimatedCostMicroUsd: 2_700,
      attempt: 1,
    });

    const other = await repositories().sopDocuments.create({
      title: 'Another',
      sourceText: 'another one',
    });

    expect(await repositories().modelUsage.attachDocument(requestId, other.id)).toBe(0);
    expect((await repositories().modelUsage.totalsForDocument(documentId)).totalTokens).toBe(500);
    expect((await repositories().modelUsage.totalsForDocument(other.id)).totalTokens).toBe(0);
  });

  it('lists a document’s calls so a draft can show what it cost', async () => {
    const requestId = newModelRequestId();

    for (const attempt of [1, 2]) {
      await repositories().modelUsage.record({
        requestId,
        documentId,
        provider: 'fake',
        model: 'fake-model',
        inputTokens: 10 * attempt,
        outputTokens: attempt,
        estimatedCostMicroUsd: attempt,
        attempt,
      });
    }

    const listed = await repositories().modelUsage.listForDocument(documentId);

    expect(listed.map((row) => row.attempt)).toEqual([1, 2]);
    expect(listed[0]?.model).toBe('fake-model');
  });
});
