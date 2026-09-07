import { newSopDocumentId } from '@orbit/contracts';
import type { ModelUsageTotals } from '@orbit/db';
import type { CreateSopDraftResult } from '@orbit/sop-service';
import { describe, expect, it } from 'vitest';

import { buildServer } from '../server';
import { createStubContext } from '../testing/stub-context';
import type { ModelUsageView } from '../views';

/**
 * The spend readout, and the refusal it exists to warn about.
 *
 * The readout is a courtesy: the server refuses an over-budget Generate whether
 * or not anything asked. What is asserted here is that the two agree — the same
 * ceilings feed both — and that a budget refusal reaches a client as its own
 * status rather than as "your text was rejected".
 */
const DOCUMENT_ID = newSopDocumentId();

function totals(overrides: Partial<ModelUsageTotals> = {}): ModelUsageTotals {
  return {
    calls: 2,
    inputTokens: 9_000,
    outputTokens: 1_000,
    totalTokens: 10_000,
    estimatedCostMicroUsd: 42_000,
    ...overrides,
  };
}

function server(options: {
  readonly global?: ModelUsageTotals;
  readonly document?: ModelUsageTotals;
  readonly budgets?: { global?: number; document?: number; request?: number };
}) {
  return buildServer({
    logLevel: 'silent',
    context: createStubContext({
      modelBudgets: options.budgets ?? {},
      modelUsage: {
        totals: () => Promise.resolve(options.global ?? totals()),
        totalsForDocument: () =>
          Promise.resolve(options.document ?? totals({ totalTokens: 4_000 })),
      },
    }),
  });
}

async function read(app: ReturnType<typeof buildServer>, url: string): Promise<ModelUsageView> {
  const response = await app.inject({ method: 'GET', url });
  expect(response.statusCode).toBe(200);
  return (JSON.parse(response.body) as { data: ModelUsageView }).data;
}

describe('GET /v1/model-usage', () => {
  it('reports deployment-wide spend and the headroom left', async () => {
    const app = server({ budgets: { global: 1_000_000 } });
    await app.ready();

    const usage = await read(app, '/v1/model-usage');

    expect(usage.global.totalTokens).toBe(10_000);
    expect(usage.scopes).toEqual([
      {
        scope: 'global',
        label: 'the deployment-wide budget',
        limitTokens: 1_000_000,
        spentTokens: 10_000,
        remainingTokens: 990_000,
        exhausted: false,
      },
    ]);
    expect(usage.exhausted).toBe(false);
    // Stated in the payload, so no surface can show a figure without it.
    expect(usage.costIsEstimated).toBe(true);

    await app.close();
  });

  it('adds the per-document scope only when a document is asked about', async () => {
    const app = server({ budgets: { global: 1_000_000, document: 100_000 } });
    await app.ready();

    expect((await read(app, '/v1/model-usage')).document).toBeNull();

    const scoped = await read(app, `/v1/model-usage?documentId=${DOCUMENT_ID}`);

    expect(scoped.document?.totalTokens).toBe(4_000);
    expect(scoped.scopes.map((scope) => scope.scope)).toEqual(['global', 'document']);

    await app.close();
  });

  it('reports an uncapped scope as uncapped rather than as a ceiling of zero', async () => {
    const app = server({});
    await app.ready();

    expect((await read(app, '/v1/model-usage')).scopes[0]?.limitTokens).toBeNull();

    await app.close();
  });

  it('says a scope is exhausted, and never reports negative headroom', async () => {
    // A call can overshoot: the check charges an assumed size beforehand and the
    // real one may be larger. "-4,000 tokens left" reads as a bug; `exhausted`
    // is the fact that matters.
    const app = server({
      global: totals({ totalTokens: 1_001_000 }),
      budgets: { global: 1_000_000 },
    });
    await app.ready();

    const usage = await read(app, '/v1/model-usage');

    expect(usage.scopes[0]?.remainingTokens).toBe(0);
    expect(usage.scopes[0]?.exhausted).toBe(true);
    expect(usage.exhausted).toBe(true);

    await app.close();
  });

  it('refuses a documentId that is not one', async () => {
    const app = server({});
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/v1/model-usage?documentId=nope' });

    expect(response.statusCode).toBe(400);

    await app.close();
  });
});

describe('POST /v1/sop-drafts, when a budget stops it', () => {
  function draftServer(result: CreateSopDraftResult) {
    return buildServer({
      logLevel: 'silent',
      context: createStubContext({
        sopDraftService: { createDraft: () => Promise.resolve(result) },
      }),
    });
  }

  it('answers 429, not 422: nothing about the request was wrong', async () => {
    const app = draftServer({
      ok: false,
      reason: 'budget_exhausted',
      refusal: {
        scope: 'global',
        limit: 1_000,
        spent: 1_000,
        message: 'This would exceed the deployment-wide budget. No call was made.',
      },
    });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/sop-drafts',
      payload: { sourceText: 'Look up a request.' },
    });

    expect(response.statusCode).toBe(429);
    expect(response.body).toContain('No call was made');

    await app.close();
  });

  it('reports a refused repair as a budget problem, with the draft’s own issues', async () => {
    const app = draftServer({
      ok: false,
      reason: 'budget_exhausted_before_repair',
      refusal: {
        scope: 'request',
        limit: 12_000,
        spent: 10_000,
        message: 'This would exceed the budget for a single Generate. No call was made.',
      },
      issues: [
        {
          code: 'UNKNOWN_ENTRY_STEP',
          message: 'entryStepId names no step.',
          path: ['entryStepId'],
        },
      ],
    });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/sop-drafts',
      payload: { sourceText: 'Look up a request.' },
    });

    expect(response.statusCode).toBe(429);
    // Both facts, because both are true: the repair was refused, and the draft
    // that exists is invalid for reasons the person can see.
    expect(response.body).toContain('the repair that might have fixed it was not attempted');
    expect(response.body).toContain('UNKNOWN_ENTRY_STEP');

    await app.close();
  });
});
