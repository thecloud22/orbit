import type { SopDocumentId } from '@orbit/contracts';
import { createRepositories } from '@orbit/db';
import { useTestDatabase } from '@orbit/db/testing';
import { borrowOrHoldGraph } from '@orbit/sop-graph/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createFakeRecordingSessionFactory,
  elementCapture,
  navigation,
  type FakeRecordingSession,
} from '../testing/fake-recording-session';
import {
  createWalkthroughSessionRegistry,
  type WalkthroughSessionRegistry,
} from './walkthrough-session-registry';

/**
 * The walkthrough sitting, against real persistence and a fake browser
 * (ADR-035).
 *
 * The browser is the only thing substituted, exactly as it is for recording and
 * for binding sessions: the alignment, the proposal rows and the document are
 * all real, so what these assert is what a person would actually get.
 */
describe('walkthrough sessions', () => {
  const getDatabase = useTestDatabase();

  let documentId: SopDocumentId;
  let registry: WalkthroughSessionRegistry;
  let opened: FakeRecordingSession[];

  function repositories() {
    return createRepositories(getDatabase().db);
  }

  /** The borrow path, as a person would perform it in one sitting. */
  function scriptBorrowPath(session: FakeRecordingSession): void {
    session.push(navigation('http://localhost:3020/catalog', 1));
    session.push(
      elementCapture({
        type: 'fill',
        order: 2,
        testId: 'catalog-search-input',
        name: 'Search the catalog',
        typedValue: '978-0-13-235088-4',
      }),
    );
    session.push(
      elementCapture({ type: 'click', order: 3, testId: 'catalog-search-button', name: 'Search' }),
    );
    session.push(
      elementCapture({
        type: 'fill',
        order: 4,
        testId: 'borrow-member-id',
        name: 'Member ID',
        typedValue: 'LIB-1001',
      }),
    );
    session.push(
      elementCapture({ type: 'click', order: 5, testId: 'borrow-button', name: 'Borrow' }),
    );
    session.push(
      elementCapture({
        type: 'pick',
        order: 6,
        testId: 'borrow-confirmation',
        name: 'Borrow confirmation',
      }),
    );
  }

  beforeEach(async () => {
    opened = [];

    const document = await repositories().sopDocuments.create({
      title: 'Borrow a title, or place a hold',
      sourceText: 'Search the catalog, then borrow or place a hold.',
    });

    await repositories().sopGraphRevisions.create({
      documentId: document.id,
      graph: borrowOrHoldGraph(),
      provenance: { kind: 'authored' },
    });

    documentId = document.id;

    registry = createWalkthroughSessionRegistry({
      database: getDatabase().db,
      factory: createFakeRecordingSessionFactory({
        onOpen: (session) => {
          opened.push(session);
          scriptBorrowPath(session);
        },
      }),
    });
  });

  it('opens one browser and reports how many steps are waiting', async () => {
    const started = await registry.start({
      documentId,
      startUrl: 'http://localhost:3020/catalog',
    });

    expect(started.ok).toBe(true);

    if (!started.ok) {
      return;
    }

    // Nine steps a binding is required for: two fills and a click on the shared
    // path, a decision, and three steps down each branch.
    expect(started.state.awaitingBinding).toBe(9);
    expect(started.state.browserOpen).toBe(true);
    expect(started.state.outcome).toBeNull();
    expect(started.state.mode).toBe('action');
    // The navigation is part of what was captured, so the person can see where
    // the walkthrough has been.
    expect(started.state.captures.map((capture) => capture.kind)).toEqual([
      'navigate',
      'fill',
      'click',
      'fill',
      'click',
      'pick',
    ]);
    expect(opened).toHaveLength(1);
  });

  it('refuses a second walkthrough of the same workflow', async () => {
    const first = await registry.start({
      documentId,
      startUrl: 'http://localhost:3020/catalog',
    });
    const second = await registry.start({
      documentId,
      startUrl: 'http://localhost:3020/catalog',
    });

    expect(second).toMatchObject({ ok: false, reason: 'session_exists' });

    if (first.ok && !second.ok && second.reason === 'session_exists') {
      expect(second.sessionId).toBe(first.state.sessionId);
    }

    // Refused before a browser was opened, not after.
    expect(opened).toHaveLength(1);
  });

  it('proposes the demonstrated path, explains the rest, and closes the browser', async () => {
    const started = await registry.start({
      documentId,
      startUrl: 'http://localhost:3020/catalog',
    });

    if (!started.ok) {
      throw new Error('the walkthrough did not start');
    }

    const proposed = await registry.propose(started.state.sessionId);

    expect(proposed.ok).toBe(true);

    if (!proposed.ok) {
      return;
    }

    const outcome = proposed.state.outcome;

    expect(outcome?.proposed).toBe(5);
    expect(outcome?.steps).toHaveLength(9);

    const decision = outcome?.steps.find((step) => step.stepId === 'check_availability');
    expect(decision?.proposalId).toBeNull();
    expect(decision?.refusal).toBe('decision_needs_each_branch');
    // The message is what a person reads, so it has to say what to do next.
    expect(decision?.message).toContain('branch by branch');

    const hold = outcome?.steps.find((step) => step.stepId === 'place_hold');
    expect(hold?.proposalId).toBeNull();
    expect(hold?.refusal).toBe('nothing_matched');

    // The browser is gone: the task is over, and this is where a walkthrough
    // differs from a binding sitting, which keeps its page.
    expect(proposed.state.browserOpen).toBe(false);
    expect(opened[0]?.closed()).toBe(true);

    // Proposals, and not one binding.
    expect(await repositories().bindingRecoveryProposals.listOpen(documentId)).toHaveLength(5);
    expect(await repositories().executionBindings.listCurrent(documentId)).toHaveLength(0);
  });

  it('reports each proposal’s state as it stands, not as it was proposed', async () => {
    const started = await registry.start({
      documentId,
      startUrl: 'http://localhost:3020/catalog',
    });

    if (!started.ok) {
      throw new Error('the walkthrough did not start');
    }

    const proposed = await registry.propose(started.state.sessionId);

    if (!proposed.ok) {
      throw new Error('the walkthrough produced nothing');
    }

    const forSearch = proposed.state.outcome?.steps.find(
      (step) => step.stepId === 'search_catalog',
    );
    expect(forSearch?.state).toBe('proposed');

    // Somebody dismisses it elsewhere. The review screen must not still offer
    // to accept it.
    await repositories().bindingRecoveryProposals.dismiss(forSearch?.proposalId as never);

    const reread = await registry.get(started.state.sessionId);
    const after = reread?.outcome?.steps.find((step) => step.stepId === 'search_catalog');

    expect(after?.state).toBe('dismissed');
  });

  it('is idempotent: finishing twice returns the first result rather than proposing again', async () => {
    const started = await registry.start({
      documentId,
      startUrl: 'http://localhost:3020/catalog',
    });

    if (!started.ok) {
      throw new Error('the walkthrough did not start');
    }

    const first = await registry.propose(started.state.sessionId);
    const second = await registry.propose(started.state.sessionId);

    expect(first.ok && second.ok).toBe(true);

    if (!first.ok || !second.ok) {
      return;
    }

    expect(second.state.outcome?.proposed).toBe(first.state.outcome?.proposed);
    expect(await repositories().bindingRecoveryProposals.listOpen(documentId)).toHaveLength(5);
  });

  it('keeps what was demonstrated when the person closes the window first', async () => {
    const started = await registry.start({
      documentId,
      startUrl: 'http://localhost:3020/catalog',
    });

    if (!started.ok) {
      throw new Error('the walkthrough did not start');
    }

    // Their browser, and nothing stops them closing it. Losing an hour of
    // demonstration for it would be the same mistake `bind` was fixed for.
    await opened[0]?.close();

    const proposed = await registry.propose(started.state.sessionId);

    expect(proposed.ok).toBe(true);

    if (!proposed.ok) {
      return;
    }

    expect(proposed.state.outcome?.proposed).toBe(5);
  });

  it('refuses to open a walkthrough for a workflow with nothing left to bind', async () => {
    const other = await repositories().sopDocuments.create({
      title: 'Nothing to bind',
      sourceText: 'Open a page and stop.',
    });

    // A graph whose only steps are a navigate and an outcome: neither needs a
    // binding, so a browser would produce nothing.
    await repositories().sopGraphRevisions.create({
      documentId: other.id,
      graph: {
        ...borrowOrHoldGraph(),
        entryStepId: 'open_catalog',
        outputs: [],
        steps: [
          {
            id: 'open_catalog',
            kind: 'navigate',
            urlHint: 'http://localhost:3020/catalog',
            purpose: 'Open the library catalog',
          },
          { id: 'done', kind: 'outcome', outcome: 'completed', message: 'Finished' },
        ],
      },
      provenance: { kind: 'authored' },
    });

    const started = await registry.start({
      documentId: other.id,
      startUrl: 'http://localhost:3020/catalog',
    });

    expect(started).toMatchObject({ ok: false, reason: 'nothing_to_bind' });
    expect(opened).toHaveLength(0);
  });

  it('refuses a walkthrough of a workflow that does not exist', async () => {
    const started = await registry.start({
      documentId: 'sop_doc_missing' as SopDocumentId,
      startUrl: 'http://localhost:3020/catalog',
    });

    expect(started).toMatchObject({ ok: false, reason: 'document_not_found' });
    expect(opened).toHaveLength(0);
  });

  it('closes the browser when a walkthrough is cancelled', async () => {
    const started = await registry.start({
      documentId,
      startUrl: 'http://localhost:3020/catalog',
    });

    if (!started.ok) {
      throw new Error('the walkthrough did not start');
    }

    expect(await registry.cancel(started.state.sessionId)).toBe(true);
    expect(opened[0]?.closed()).toBe(true);
    expect(await registry.get(started.state.sessionId)).toBeNull();

    // Nothing was proposed, so nothing was written.
    expect(await repositories().bindingRecoveryProposals.listOpen(documentId)).toHaveLength(0);

    // And the document is free for another walkthrough.
    const again = await registry.start({
      documentId,
      startUrl: 'http://localhost:3020/catalog',
    });
    expect(again.ok).toBe(true);
  });
});
