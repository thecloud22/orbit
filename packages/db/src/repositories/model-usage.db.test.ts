import {
  newModelRequestId,
  newSopDocumentId,
  type AgentId,
  type SopDocumentId,
} from '@orbit/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import { createRepositories } from './index';
import { seedFindServiceRequest } from '../seed';
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

  /**
   * The two scopes an execution can measure, added for judged decisions.
   *
   * The same ledger, the same rows, the same `SUM`. Two tables of spend would
   * eventually disagree with each other, and the one a cap was enforced against
   * would not be the one anybody was shown.
   */
  describe('the run and agent scopes', () => {
    it('sums a run’s judged decisions, and no other run’s', async () => {
      const seeded = await seedFindServiceRequest(getDatabase().db);
      const run = await repositories().runs.create({
        agentVersionId: seeded.agentVersion.id,
        trigger: {
          type: 'watchtower_manual',
          actor: { type: 'development_user', id: 'dev' },
          source: { application: 'test' },
        },
        inputs: { requestNumber: 'SR-1001' },
      });

      for (const tokens of [100, 250]) {
        await repositories().modelUsage.record({
          requestId: newModelRequestId(),
          runId: run.id,
          agentVersionId: seeded.agentVersion.id,
          provider: 'fake',
          model: 'fake-model',
          inputTokens: tokens,
          outputTokens: 0,
          estimatedCostMicroUsd: tokens,
          attempt: 1,
        });
      }

      // A drafting call, attributed to no run at all.
      await repositories().modelUsage.record({
        requestId: newModelRequestId(),
        documentId,
        provider: 'fake',
        model: 'fake-model',
        inputTokens: 9_999,
        outputTokens: 0,
        estimatedCostMicroUsd: 1,
        attempt: 1,
      });

      expect((await repositories().modelUsage.totalsForRun(run.id)).totalTokens).toBe(350);
      expect((await repositories().modelUsage.totalsForRun(run.id)).calls).toBe(2);

      // The global pot still sees every call, drafting included.
      expect((await repositories().modelUsage.totals()).totalTokens).toBe(10_349);
    });

    it('sums an agent’s spend across its versions, so republishing does not clear the cap', async () => {
      const seeded = await seedFindServiceRequest(getDatabase().db);

      await repositories().modelUsage.record({
        requestId: newModelRequestId(),
        agentVersionId: seeded.agentVersion.id,
        provider: 'fake',
        model: 'fake-model',
        inputTokens: 500,
        outputTokens: 100,
        estimatedCostMicroUsd: 10,
        attempt: 1,
      });

      const second = await repositories().agentVersions.create({
        agentIr: { ...seeded.agentVersion.agentIr, version: '0.2.0' },
      });

      await repositories().modelUsage.record({
        requestId: newModelRequestId(),
        agentVersionId: second.id,
        provider: 'fake',
        model: 'fake-model',
        inputTokens: 400,
        outputTokens: 0,
        estimatedCostMicroUsd: 10,
        attempt: 1,
      });

      // 600 from the first version plus 400 from the second. A per-version cap
      // would have reported 400 here and reset every time somebody published.
      const totals = await repositories().modelUsage.totalsForAgent(
        seeded.agentVersion.agentIr.id as AgentId,
      );

      expect(totals.totalTokens).toBe(1_000);
      expect(totals.calls).toBe(2);
    });

    it('reports zero for an agent that has never made a judged decision', async () => {
      const seeded = await seedFindServiceRequest(getDatabase().db);

      const totals = await repositories().modelUsage.totalsForAgent(
        seeded.agentVersion.agentIr.id as AgentId,
      );

      expect(totals).toMatchObject({ calls: 0, totalTokens: 0 });
    });

    it('keeps the spend record when the run it belonged to is deleted', async () => {
      const seeded = await seedFindServiceRequest(getDatabase().db);
      const run = await repositories().runs.create({
        agentVersionId: seeded.agentVersion.id,
        trigger: {
          type: 'watchtower_manual',
          actor: { type: 'development_user', id: 'dev' },
          source: { application: 'test' },
        },
        inputs: { requestNumber: 'SR-1001' },
      });

      await repositories().modelUsage.record({
        requestId: newModelRequestId(),
        runId: run.id,
        agentVersionId: seeded.agentVersion.id,
        provider: 'fake',
        model: 'fake-model',
        inputTokens: 100,
        outputTokens: 0,
        estimatedCostMicroUsd: 1,
        attempt: 1,
      });

      // `set null` rather than `cascade`: deleting a run must not delete the
      // record that money was spent.
      expect((await repositories().modelUsage.totals()).calls).toBe(1);
    });
  });
});
