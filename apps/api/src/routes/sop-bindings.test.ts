import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { newExecutionBindingId, newSopDocumentId, newSopRevisionId } from '@orbit/contracts';
import { stepChecksum, type ExecutionBindingRecord, type SopGraphRevisionRecord } from '@orbit/db';
import {
  EXECUTION_BINDING_SCHEMA_VERSION,
  type BindingState,
  type SelectorChain,
} from '@orbit/execution-mapping';
import { buttonFingerprint } from '@orbit/execution-mapping/testing';
import { escalationReviewGraph } from '@orbit/sop-graph/testing';
import type { SopStep } from '@orbit/sop-graph';
import { describe, expect, it } from 'vitest';

import { buildServer } from '../server';
import { createStubContext } from '../testing/stub-context';

/**
 * The read-only binding view.
 *
 * Two things are asserted here beyond the wire shape. That every lifecycle
 * state a *current* binding can hold renders — and that `superseded` is not one
 * of them, because a binding is superseded only when its replacement is written
 * alongside it. And that this route cannot write, which is proven by giving it a
 * context where every write method throws.
 */
const DOCUMENT_ID = newSopDocumentId();
const REVISION_ID = newSopRevisionId();
const GRAPH = escalationReviewGraph();

function step(id: string): SopStep {
  const found = GRAPH.steps.find((candidate) => candidate.id === id);
  if (found === undefined) {
    throw new Error(`The fixture has no step "${id}".`);
  }
  return found;
}

const SELECTORS = [
  { strategy: 'test_id', value: 'search-request-button' },
  { strategy: 'role_and_name', value: 'button', name: 'Search' },
] as SelectorChain;

function binding(input: {
  readonly stepId: string;
  readonly state: BindingState;
  readonly stepSha256?: string;
}): ExecutionBindingRecord {
  return {
    id: newExecutionBindingId(),
    documentId: DOCUMENT_ID,
    stepId: input.stepId,
    bindingNumber: 1,
    binding: {
      schemaVersion: EXECUTION_BINDING_SCHEMA_VERSION,
      stepId: input.stepId,
      body: { kind: 'click', target: { selectors: SELECTORS, fingerprint: buttonFingerprint() } },
      capturedAgainstRevisionId: REVISION_ID,
      stepSha256: input.stepSha256 ?? stepChecksum(step(input.stepId)),
    },
    bindingSha256: 'a'.repeat(64),
    state: input.state,
    capturedAgainstRevisionId: REVISION_ID,
    parentBindingId: null,
    supersededByBindingId: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: new Date('2026-09-06T12:00:00.000Z'),
    updatedAt: new Date('2026-09-06T12:00:00.000Z'),
  };
}

const REVISION: SopGraphRevisionRecord = {
  id: REVISION_ID,
  documentId: DOCUMENT_ID,
  revisionNumber: 1,
  graph: GRAPH,
  graphSha256: 'b'.repeat(64),
  state: 'approved',
  provenance: { kind: 'authored' },
  parentRevisionId: null,
  supersededByRevisionId: null,
  reviewedAt: new Date('2026-09-06T12:00:00.000Z'),
  reviewNote: null,
  createdAt: new Date('2026-09-06T12:00:00.000Z'),
  updatedAt: new Date('2026-09-06T12:00:00.000Z'),
};

/**
 * A context with only the three reads this route needs.
 *
 * `createStubContext` throws on any method a test did not stub, naming it — so
 * if the route ever attempted `create`, `approve`, `reject`, `submitForReview`
 * or `returnToDraft`, this fails loudly rather than silently succeeding.
 */
function server(options: {
  readonly current?: readonly ExecutionBindingRecord[];
  readonly all?: readonly ExecutionBindingRecord[];
  readonly revision?: SopGraphRevisionRecord | null;
}) {
  return buildServer({
    logLevel: 'silent',
    context: createStubContext({
      sopGraphRevisions: {
        findCurrent: () =>
          Promise.resolve(options.revision === undefined ? REVISION : options.revision),
      },
      executionBindings: {
        listCurrent: () => Promise.resolve(options.current ?? []),
        listByDocument: () => Promise.resolve(options.all ?? options.current ?? []),
      },
    }),
  });
}

async function get(app: ReturnType<typeof buildServer>) {
  await app.ready();
  return app.inject({ method: 'GET', url: `/v1/sop-documents/${DOCUMENT_ID}/bindings` });
}

describe('GET /v1/sop-documents/:documentId/bindings', () => {
  it('reports a step with no binding', async () => {
    const app = server({});
    const response = await get(app);

    expect(response.statusCode).toBe(200);

    const found = response
      .json()
      .data.steps.find((entry: { stepId: string }) => entry.stepId === 'sign_in');
    expect(found.status).toBeNull();
    expect(found.bindingId).toBeNull();
    expect(found.bindable).toBe(true);

    await app.close();
  });

  it('marks a manual_review step unbindable rather than merely unbound', async () => {
    const app = server({});
    const manual = GRAPH.steps.find((candidate) => candidate.kind === 'manual_review')!;

    const found = (await get(app))
      .json()
      .data.steps.find((entry: { stepId: string }) => entry.stepId === manual.id);

    // Not a gap in coverage — a permanent, correct state.
    expect(found.bindable).toBe(false);
    expect(found.status).toBeNull();

    await app.close();
  });

  for (const state of ['draft', 'needs_review', 'approved', 'rejected'] as const) {
    it(`renders a ${state} binding`, async () => {
      const app = server({ current: [binding({ stepId: 'sign_in', state })] });

      const found = (await get(app))
        .json()
        .data.steps.find((entry: { stepId: string }) => entry.stepId === 'sign_in');

      expect(found.status).toBe(state);
      expect(found.bindingId).not.toBeNull();

      await app.close();
    });
  }

  it('publishes the selector chain and fingerprint for an approved binding only', async () => {
    const approved = server({ current: [binding({ stepId: 'sign_in', state: 'approved' })] });
    const draft = server({ current: [binding({ stepId: 'sign_in', state: 'draft' })] });

    const withChain = (await get(approved))
      .json()
      .data.steps.find((entry: { stepId: string }) => entry.stepId === 'sign_in');
    const withoutChain = (await get(draft))
      .json()
      .data.steps.find((entry: { stepId: string }) => entry.stepId === 'sign_in');

    expect(withChain.selectors).toEqual([
      { strategy: 'test_id', value: 'search-request-button', name: null },
      { strategy: 'role_and_name', value: 'button', name: 'Search' },
    ]);
    expect(withChain.fingerprint.role).toBe('button');

    // A draft is still in flux and confirmed in the terminal, so its chain is
    // deliberately not published here.
    expect(withoutChain.selectors).toBeNull();
    expect(withoutChain.fingerprint).toBeNull();

    await approved.close();
    await draft.close();
  });

  it('counts superseded predecessors, which are never the current state', async () => {
    const app = server({
      current: [binding({ stepId: 'sign_in', state: 'approved' })],
      all: [
        binding({ stepId: 'sign_in', state: 'superseded' }),
        binding({ stepId: 'sign_in', state: 'superseded' }),
        binding({ stepId: 'sign_in', state: 'approved' }),
      ],
    });

    const found = (await get(app))
      .json()
      .data.steps.find((entry: { stepId: string }) => entry.stepId === 'sign_in');

    expect(found.status).toBe('approved');
    expect(found.supersededCount).toBe(2);

    await app.close();
  });

  it('reports an approved binding as stale once its step has changed', async () => {
    // Status and staleness are orthogonal. Showing only the status would let
    // "approved" read as "usable" when the step has moved underneath it.
    const app = server({
      current: [binding({ stepId: 'sign_in', state: 'approved', stepSha256: 'c'.repeat(64) })],
    });

    const found = (await get(app))
      .json()
      .data.steps.find((entry: { stepId: string }) => entry.stepId === 'sign_in');

    expect(found.status).toBe('approved');
    expect(found.stale).toBe(true);
    expect(found.issues.map((issue: { code: string }) => issue.code)).toContain('STALE_BINDING');

    await app.close();
  });

  it('summarises coverage across the workflow', async () => {
    const app = server({
      current: [
        binding({ stepId: 'sign_in', state: 'approved' }),
        binding({ stepId: 'open_portal', state: 'draft' }),
      ],
    });

    const summary = (await get(app)).json().data.summary;

    // Unbindable steps are excluded from the denominator: they will never have
    // a binding, and counting them would make full coverage unreachable.
    expect(summary.bindable).toBe(GRAPH.steps.filter((s) => s.kind !== 'manual_review').length);
    expect(summary.bound).toBe(2);
    expect(summary.approved).toBe(1);
    expect(summary.stale).toBe(0);

    await app.close();
  });

  it('404s for a document that does not exist', async () => {
    const app = server({ revision: null });
    expect((await get(app)).statusCode).toBe(404);
    await app.close();
  });

  it('rejects a malformed document id', async () => {
    const app = server({});
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/v1/sop-documents/not-an-orbit-id/bindings',
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('publishes no checksum, storage key, or raw row', async () => {
    const app = server({ current: [binding({ stepId: 'sign_in', state: 'approved' })] });
    const body = (await get(app)).body;

    expect(body).not.toContain('bindingSha256');
    expect(body).not.toContain('stepSha256');
    expect(body).not.toContain('storageKey');

    await app.close();
  });
});

describe('the route cannot write', () => {
  it('completes using only read methods', async () => {
    // Every unstubbed repository method throws with its own name, so a write
    // attempt is a loud failure rather than a silent success. That this test
    // passes at all is the proof.
    const app = server({ current: [binding({ stepId: 'sign_in', state: 'approved' })] });

    expect((await get(app)).statusCode).toBe(200);

    await app.close();
  });

  it('names no write method in its source', () => {
    // Defence in depth: the runtime proof above only covers the paths a test
    // exercises, while this covers the file.
    const source = readFileSync(
      fileURLToPath(new URL('./sop-bindings.ts', import.meta.url)),
      'utf8',
    );

    for (const method of ['create(', 'approve(', 'reject(', 'submitForReview(', 'returnToDraft(']) {
      expect(source).not.toContain(`executionBindings.${method}`);
      expect(source).not.toContain(`.${method}`);
    }
  });
});
