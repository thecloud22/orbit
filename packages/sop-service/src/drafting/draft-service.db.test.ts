import { newSopDocumentId } from '@orbit/contracts';
import {
  createRepositories,
  sopDocuments,
  sopGraphRevisions,
  withTransaction,
  type OrbitDatabase,
} from '@orbit/db';
import { useTestDatabase } from '@orbit/db/testing';
import {
  createFakeSopProvider,
  failWith,
  invalidSopGraphProposal,
  respondInOrder,
  respondWith,
  validSopGraphProposal,
} from '@orbit/sop-generation/testing';
import { SOP_GRAPH_SCHEMA_VERSION } from '@orbit/sop-graph';
import { describe, expect, it } from 'vitest';

import { createSopDraftService } from './draft-service';

/**
 * SOP draft generation against real persistence.
 *
 * The model is the one thing faked, and it is faked deterministically with no
 * network call at all. Everything else — the transaction, the checksum, the
 * revision chain, the provenance — is the real thing.
 */

const SOURCE_TEXT =
  'Sign in to the service request portal, search for the request number, and report its status.';

async function countRows(database: OrbitDatabase) {
  const documents = await database.select().from(sopDocuments);
  const revisions = await database.select().from(sopGraphRevisions);
  return { documents: documents.length, revisions: revisions.length };
}

describe('SOP draft persistence', () => {
  const getDatabase = useTestDatabase();

  function serviceWith(responses: Parameters<typeof respondInOrder>[0]) {
    return createSopDraftService({
      database: getDatabase().db,
      provider: createFakeSopProvider({
        respond: respondInOrder(responses),
        descriptor: { provider: 'fake', model: 'fake-model' },
      }),
    });
  }

  it('persists the document and its first revision together', async () => {
    const service = serviceWith([respondWith(validSopGraphProposal())]);

    const result = await service.createDraft({ kind: 'new_document', sourceText: SOURCE_TEXT });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.document.sourceText).toBe(SOURCE_TEXT);
    expect(result.document.title).toBe('Service request escalation review');
    expect(result.revision.revisionNumber).toBe(1);
    expect(result.revision.state).toBe('draft');
    expect(result.revision.parentRevisionId).toBeNull();
    expect(result.revision.graph.schemaVersion).toBe(SOP_GRAPH_SCHEMA_VERSION);

    // Both rows, not one: read back through the repositories rather than from
    // the returned objects.
    const repositories = createRepositories(getDatabase().db);
    const document = await repositories.sopDocuments.findById(result.document.id);
    const revision = await repositories.sopGraphRevisions.findCurrent(result.document.id);

    expect(document).not.toBeNull();
    expect(revision?.id).toBe(result.revision.id);
    expect(revision?.graph.steps.length).toBe(result.revision.graph.steps.length);
  });

  it('records which model produced the draft', async () => {
    const service = serviceWith([respondWith(validSopGraphProposal())]);

    const result = await service.createDraft({ kind: 'new_document', sourceText: SOURCE_TEXT });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const stored = await createRepositories(getDatabase().db).sopGraphRevisions.findById(
      result.revision.id,
    );

    expect(stored?.provenance).toEqual({
      kind: 'generated',
      provider: 'fake',
      model: 'fake-model',
      promptVersion: 'sop-graph-generation@1',
      generatedAt: result.generation.generatedAt,
    });
    expect(Date.parse(result.generation.generatedAt)).not.toBeNaN();
  });

  it('persists a graph that was invalid first and repaired second', async () => {
    const service = serviceWith([
      respondWith(invalidSopGraphProposal()),
      respondWith(validSopGraphProposal()),
    ]);

    const result = await service.createDraft({ kind: 'new_document', sourceText: SOURCE_TEXT });

    expect(result.ok).toBe(true);
    expect(result.ok && result.generation.attempts).toBe(2);
    await expect(countRows(getDatabase().db)).resolves.toEqual({ documents: 1, revisions: 1 });
  });

  it('writes nothing when the graph is still invalid after the repair', async () => {
    const service = serviceWith([
      respondWith(invalidSopGraphProposal()),
      respondWith(invalidSopGraphProposal()),
    ]);

    const result = await service.createDraft({ kind: 'new_document', sourceText: SOURCE_TEXT });

    expect(result.ok === false && result.reason).toBe('invalid_after_repair');
    await expect(countRows(getDatabase().db)).resolves.toEqual({ documents: 0, revisions: 0 });
  });

  it('writes nothing when the provider fails, and says so distinctly', async () => {
    const service = serviceWith([failWith('the model endpoint refused the connection')]);

    const result = await service.createDraft({ kind: 'new_document', sourceText: SOURCE_TEXT });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.reason).toBe('provider_error');
    await expect(countRows(getDatabase().db)).resolves.toEqual({ documents: 0, revisions: 0 });
  });

  /**
   * The property everything above rests on.
   *
   * `sopGraphRevisions.create` opens a transaction of its own. Called inside an
   * outer one, that has to become a SAVEPOINT rather than a second
   * connection-level transaction — otherwise a revision would commit
   * independently and an outer rollback would leave a revision without its
   * document. This asserts the behaviour rather than assuming it.
   */
  it('rolls back a revision written inside an outer transaction that then fails', async () => {
    const database = getDatabase().db;

    await expect(
      withTransaction(database, async (repositories) => {
        const document = await repositories.sopDocuments.create({
          title: 'Escalation review',
          sourceText: SOURCE_TEXT,
        });

        await repositories.sopGraphRevisions.create({
          documentId: document.id,
          graph: {
            ...(validSopGraphProposal() as Record<string, unknown>),
            schemaVersion: SOP_GRAPH_SCHEMA_VERSION,
          } as Parameters<typeof repositories.sopGraphRevisions.create>[0]['graph'],
          provenance: { kind: 'generated' },
        });

        throw new Error('something after the revision was written');
      }),
    ).rejects.toThrow('something after the revision was written');

    await expect(countRows(database)).resolves.toEqual({ documents: 0, revisions: 0 });
  });

  it('adds a revision to an existing document and supersedes the previous one', async () => {
    const first = await serviceWith([respondWith(validSopGraphProposal())]).createDraft({
      kind: 'new_document',
      sourceText: SOURCE_TEXT,
    });

    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await serviceWith([respondWith(validSopGraphProposal())]).createDraft({
      kind: 'new_revision',
      documentId: first.document.id,
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.document.id).toBe(first.document.id);
    expect(second.revision.revisionNumber).toBe(2);
    expect(second.revision.parentRevisionId).toBe(first.revision.id);

    const repositories = createRepositories(getDatabase().db);
    const parent = await repositories.sopGraphRevisions.findById(first.revision.id);

    expect(parent?.state).toBe('superseded');
    expect(parent?.supersededByRevisionId).toBe(second.revision.id);

    // One document, two revisions: regenerating never creates a second document.
    await expect(countRows(getDatabase().db)).resolves.toEqual({ documents: 1, revisions: 2 });
  });

  it('regenerates from the text the document already holds', async () => {
    const first = await serviceWith([respondWith(validSopGraphProposal())]).createDraft({
      kind: 'new_document',
      sourceText: SOURCE_TEXT,
    });

    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const provider = createFakeSopProvider({
      respond: respondInOrder([respondWith(validSopGraphProposal())]),
    });

    await createSopDraftService({ database: getDatabase().db, provider }).createDraft({
      kind: 'new_revision',
      documentId: first.document.id,
    });

    // The original text, not something supplied again: source text has no update
    // path, so a revision is always generated from what the user wrote.
    expect(provider.requests[0]?.sourceText).toBe(SOURCE_TEXT);
  });

  it('reports an unknown document without calling the model', async () => {
    const provider = createFakeSopProvider({
      respond: () => {
        throw new Error('The provider must not be called for a document that does not exist.');
      },
    });

    const result = await createSopDraftService({
      database: getDatabase().db,
      provider,
    }).createDraft({ kind: 'new_revision', documentId: newSopDocumentId() });

    expect(result.ok === false && result.reason).toBe('document_not_found');
    expect(provider.callCount).toBe(0);
  });

  it('persists a graph full of URL hints without contacting any of them', async () => {
    const original = globalThis.fetch;
    const calls: string[] = [];

    globalThis.fetch = ((input: unknown) => {
      calls.push(String(input));
      throw new Error('Nothing in this path may fetch a URL that came out of a graph.');
    }) as typeof globalThis.fetch;

    try {
      const result = await serviceWith([respondWith(validSopGraphProposal())]).createDraft({
        kind: 'new_document',
        sourceText: SOURCE_TEXT,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const hints = result.revision.graph.steps.flatMap((step) =>
        step.kind === 'navigate' && step.urlHint !== undefined ? [step.urlHint] : [],
      );

      // Carried into storage as text, and never contacted.
      expect(hints).toContain('https://service-portal.example.com/login');
      expect(calls).toEqual([]);
    } finally {
      globalThis.fetch = original;
    }
  });
});

/**
 * The token cap, over real persistence.
 *
 * The pipeline's own tests prove the check happens before the call. These prove
 * the other half: that the ledger is written whatever the outcome, that spend is
 * read back from it on the next Generate, and that a brand-new document adopts
 * the calls that made it.
 */
describe('model spend and budgets', () => {
  const getDatabase = useTestDatabase();

  function service(options: {
    readonly responses: Parameters<typeof respondInOrder>[0];
    readonly budgets?: Parameters<typeof createSopDraftService>[0]['budgets'];
  }) {
    return createSopDraftService({
      database: getDatabase().db,
      provider: createFakeSopProvider({ respond: respondInOrder(options.responses) }),
      ...(options.budgets === undefined ? {} : { budgets: options.budgets }),
      rates: { 'fake-model': { inputPerMillionUsd: 3, outputPerMillionUsd: 15 } },
    });
  }

  it('records one ledger row per call, attributed to the document it made', async () => {
    const result = await service({
      responses: [
        respondWith(invalidSopGraphProposal(), { inputTokens: 700, outputTokens: 300 }),
        respondWith(validSopGraphProposal(), { inputTokens: 900, outputTokens: 100 }),
      ],
    }).createDraft({ kind: 'new_document', sourceText: SOURCE_TEXT });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const repositories = createRepositories(getDatabase().db);
    const rows = await repositories.modelUsage.listForDocument(result.document.id);

    // Two calls, not one draft: the unit that is billed is the unit recorded.
    expect(rows.map((row) => row.attempt)).toEqual([1, 2]);
    expect((await repositories.modelUsage.totalsForDocument(result.document.id)).totalTokens).toBe(
      2_000,
    );

    // 1,600 input at $3/Mtok plus 400 output at $15/Mtok = $0.0108.
    expect(
      (await repositories.modelUsage.totalsForDocument(result.document.id)).estimatedCostMicroUsd,
    ).toBe(10_800);
  });

  it('records the call even when the draft it produced was thrown away', async () => {
    // A call that happened cannot un-happen. Recording only successful drafts
    // would let a run of invalid ones spend without ever appearing.
    const result = await service({
      responses: [
        respondWith(invalidSopGraphProposal(), { inputTokens: 500, outputTokens: 100 }),
        respondWith(invalidSopGraphProposal(), { inputTokens: 500, outputTokens: 100 }),
      ],
    }).createDraft({ kind: 'new_document', sourceText: SOURCE_TEXT });

    expect(result.ok).toBe(false);
    expect((await createRepositories(getDatabase().db).modelUsage.totals()).totalTokens).toBe(
      1_200,
    );
  });

  it('counts a document’s earlier drafts against its own budget', async () => {
    const first = await service({
      responses: [respondWith(validSopGraphProposal(), { inputTokens: 40_000, outputTokens: 0 })],
      budgets: { document: 45_000 },
    }).createDraft({ kind: 'new_document', sourceText: SOURCE_TEXT });

    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // The second draft of the *same document* is refused, which only works
    // because the first draft's calls were adopted into it.
    const second = await service({
      responses: [respondWith(validSopGraphProposal())],
      budgets: { document: 45_000 },
    }).createDraft({ kind: 'new_revision', documentId: first.document.id });

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe('budget_exhausted');
  });

  it('leaves a document’s budget alone when another document spent the tokens', async () => {
    const first = await service({
      responses: [respondWith(validSopGraphProposal(), { inputTokens: 40_000, outputTokens: 0 })],
      budgets: { document: 45_000 },
    }).createDraft({ kind: 'new_document', sourceText: SOURCE_TEXT });

    expect(first.ok).toBe(true);

    // A different document, same ceiling, and it is unaffected — which is the
    // whole meaning of a per-agent scope.
    const second = await service({
      responses: [respondWith(validSopGraphProposal())],
      budgets: { document: 45_000 },
    }).createDraft({ kind: 'new_document', sourceText: `${SOURCE_TEXT} Again.` });

    expect(second.ok).toBe(true);
  });

  it('stops at the global ceiling regardless of which document is drafting', async () => {
    await service({
      responses: [respondWith(validSopGraphProposal(), { inputTokens: 40_000, outputTokens: 0 })],
      budgets: { global: 45_000 },
    }).createDraft({ kind: 'new_document', sourceText: SOURCE_TEXT });

    const second = await service({
      responses: [respondWith(validSopGraphProposal())],
      budgets: { global: 45_000 },
    }).createDraft({ kind: 'new_document', sourceText: `${SOURCE_TEXT} Again.` });

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe('budget_exhausted');
  });

  it('saves nothing when the budget refuses the call outright', async () => {
    await service({
      responses: [respondWith(validSopGraphProposal(), { inputTokens: 40_000, outputTokens: 0 })],
      budgets: { global: 45_000 },
    }).createDraft({ kind: 'new_document', sourceText: SOURCE_TEXT });

    const before = await countRows(getDatabase().db);

    const refused = await service({
      responses: [respondWith(validSopGraphProposal())],
      budgets: { global: 45_000 },
    }).createDraft({ kind: 'new_document', sourceText: `${SOURCE_TEXT} Again.` });

    expect(refused.ok).toBe(false);
    expect(await countRows(getDatabase().db)).toEqual(before);
  });

  it('returns the draft’s own issues when the repair was the thing refused', async () => {
    const result = await service({
      responses: [
        respondWith(invalidSopGraphProposal(), { inputTokens: 9_000, outputTokens: 1_000 }),
        respondWith(validSopGraphProposal()),
      ],
      budgets: { request: 12_000 },
    }).createDraft({ kind: 'new_document', sourceText: SOURCE_TEXT });

    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== 'budget_exhausted_before_repair') {
      throw new Error(`expected a refused repair, got ${result.ok ? 'success' : result.reason}`);
    }

    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.refusal.scope).toBe('request');
    // The first call still spent tokens, and the ledger still says so.
    expect((await createRepositories(getDatabase().db).modelUsage.totals()).totalTokens).toBe(
      10_000,
    );
  });
});
