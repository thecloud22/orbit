import { createLocalFilesystemArtifactStorage, type ArtifactStorage } from '@orbit/artifacts';
import { createTestArtifactRoot, removeTestArtifactRoot } from '@orbit/artifacts/testing';
import { borrowOrHoldBindings, borrowOrHoldGraph } from '@orbit/agent-ir-compiler/testing';
import { compileCandidate } from '@orbit/agent-ir-compiler';
import { acceptRecoveryProposal, publishedDocumentFor } from '@orbit/sop-service';
import { createRepositories } from '@orbit/db';
import { TEST_TRIGGER, useTestDatabase } from '@orbit/db/testing';
import {
  createDatabaseRecoveryProposalStore,
  createDriftRecoveryProposer,
} from '@orbit/drift-recovery';
import { createPlaywrightExecutorFactory } from '@orbit/executor-playwright';
import { executeAgentVersion } from '@orbit/runtime';
import {
  createDatabaseExecutionBindingResolver,
  createDatabaseRunStore,
} from '@orbit/runtime/persistence';
import type { SopGraph } from '@orbit/sop-graph';
import {
  adoptedProcess,
  isHttpReady,
  startManagedProcess,
  waitForHttpReady,
  withDeadline,
  type ManagedProcess,
} from '@orbit/runtime/testing';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Bounded recovery, against a page that really changed (ADR-033).
 *
 * Everything here is real: a real browser, a real portal whose `data-testid`
 * has been renamed, real approved bindings in PostgreSQL, and a real proposal
 * row at the end of it. Nothing is stubbed, because the claims worth making are
 * about the whole chain rather than about any one link in it.
 *
 * The three claims, in the order the test makes them:
 *
 *   1. A renamed test id stops the run. Not a substitution, not a retry — the
 *      run fails with typed drift evidence, exactly as it did before recovery
 *      existed.
 *   2. Orbit works out what happened, deterministically, from the binding's own
 *      fallback chain, and writes a proposal about the *document*.
 *   3. The approved binding is completely untouched until a person accepts.
 *
 * The drift is opt-in per page load — `?drift=1`, see `apps/library-portal/src/
 * demo-drift.ts` — so the portal in this repository is never left drifted and
 * there is nothing to revert.
 */
const LIBRARY_PORTAL_URL = 'http://localhost:3020/catalog';
const DRIFTED_PORTAL_URL = 'http://localhost:3020/catalog?drift=1';
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The step whose element the portal renames, and the binding that names it. */
const DRIFTED_STEP = 'search_catalog';
const RECORDED_TEST_ID = 'catalog-search-button';

/**
 * How long one run against the drifted page may take before the test says so.
 *
 * Comfortably above the ~15s a real run measures and well under the 180s
 * `testTimeout` below, so a stuck run is reported as a stuck run.
 */
const RUN_DEADLINE_MS = 90_000;

const AVAILABLE_ISBN = '978-0-13-235088-4';
const MEMBER_ID = 'LIB-1001';

/** The demo workflow, aimed at the drifted page instead of the ordinary one. */
function driftedGraph(): SopGraph {
  const graph = borrowOrHoldGraph();

  return {
    ...graph,
    steps: graph.steps.map((step) =>
      step.kind === 'navigate' ? { ...step, urlHint: DRIFTED_PORTAL_URL } : step,
    ),
  };
}

describe('recovering from a renamed test id on a real page', () => {
  const getDatabase = useTestDatabase();

  let artifactRoot: string;
  let storage: ArtifactStorage;
  let portal: ManagedProcess;
  let startedPortal = false;

  beforeAll(async () => {
    if (await isHttpReady(LIBRARY_PORTAL_URL)) {
      portal = adoptedProcess('library-portal');
    } else {
      portal = startManagedProcess({
        name: 'library-portal',
        command: 'pnpm',
        args: ['--filter', '@orbit/library-portal', 'dev'],
        cwd: REPOSITORY_ROOT,
      });

      try {
        await waitForHttpReady(LIBRARY_PORTAL_URL, 'The library portal');
      } catch (error) {
        await portal.stop();
        throw error;
      }

      startedPortal = true;
    }

    artifactRoot = await createTestArtifactRoot();
    storage = await createLocalFilesystemArtifactStorage({ root: artifactRoot });
  }, 180_000);

  afterAll(async () => {
    await removeTestArtifactRoot(artifactRoot);

    if (startedPortal) {
      await portal.stop();
    }
  });

  /**
   * The whole path a real workflow takes: document, revision, demonstrated
   * bindings, candidate, published version.
   *
   * Assembled through the repositories rather than shortcut, because the piece
   * being proven — that a run finds the fingerprints its own version was
   * compiled from — only exists if the provenance chain does.
   */
  async function publishBoundWorkflow(options: { readonly recoveryAllowed: boolean }) {
    const repositories = createRepositories(getDatabase().db);
    const graph = driftedGraph();

    const document = await repositories.sopDocuments.create({
      title: 'Borrow a title, or place a hold',
      sourceText: 'Search the catalog and borrow the title, or place a hold.',
      recoveryEnabled: options.recoveryAllowed,
    });

    const revision = await repositories.sopGraphRevisions.create({
      documentId: document.id,
      graph,
      provenance: { kind: 'authored' },
    });

    const bindingIds: string[] = [];

    for (const binding of borrowOrHoldBindings()) {
      const created = await repositories.executionBindings.create({
        documentId: document.id,
        binding: { ...binding, capturedAgainstRevisionId: revision.id },
      });
      await repositories.executionBindings.submitForReview(created.id);
      await repositories.executionBindings.approve(created.id, { reviewNote: 'Demonstrated.' });
      bindingIds.push(created.id);
    }

    const compiled = compileCandidate({
      graph,
      bindings: borrowOrHoldBindings(),
      agentId: 'agent_borrow_or_hold',
      version: '0.1.0',
      sopId: document.id,
      sopVersion: String(revision.revisionNumber),
      recoveryAllowed: options.recoveryAllowed,
    });

    if (!compiled.ok) {
      throw new Error(`the demo workflow did not compile: ${JSON.stringify(compiled.refusals)}`);
    }

    const candidate = await repositories.agentIrCandidates.create({
      documentId: document.id,
      revisionId: revision.id,
      agentIr: compiled.agentIr,
      compiledFromBindingIds: bindingIds,
      secretInputIds: compiled.secretInputIds,
      sandboxState: 'ready',
    });

    const agentIr = publishedDocumentFor(compiled.agentIr, '0.1.0');
    await repositories.agents.upsert({ id: agentIr.id, name: agentIr.name });

    const version = await repositories.agentVersions.create({
      agentIr,
      publishedFromCandidateId: candidate.id,
    });

    return { documentId: document.id, version, bindingIds };
  }

  async function runAgainstTheDriftedPage(options: { readonly recoveryAllowed: boolean }) {
    const published = await publishBoundWorkflow(options);
    const repositories = createRepositories(getDatabase().db);

    // Loaded exactly as production loads it: from the candidate the version was
    // published from, so the fingerprints checked are the ones compiled in.
    const bindings = await createDatabaseExecutionBindingResolver({
      database: getDatabase().db,
      agentVersionId: published.version.id,
    });

    const factory = createPlaywrightExecutorFactory({ headless: true });

    // Bounded well under this file's 180s `testTimeout`. A run that blocks —
    // in the browser, or on a query waiting for a lock — then fails saying so,
    // instead of running out the whole file's clock and reporting a timeout
    // that names nothing. The reset between tests is bounded the same way, in
    // `truncateOrbitTables`.
    const result = await withDeadline(
      executeAgentVersion({
        agentVersionId: published.version.id,
        agentIr: published.version.agentIr,
        inputs: { bookIsbn: AVAILABLE_ISBN, memberId: MEMBER_ID },
        trigger: TEST_TRIGGER,
        store: createDatabaseRunStore({ database: getDatabase().db, storage }),
        browser: { open: () => factory.open() },
        bindings: bindings!,
        recovery: createDriftRecoveryProposer({
          store: createDatabaseRecoveryProposalStore({ database: getDatabase().db }),
        }),
      }),
      RUN_DEADLINE_MS,
      'the run against the drifted page',
    );

    return {
      ...published,
      result,
      events: await repositories.runEvents.listByRun(result.runId),
      proposals: await repositories.bindingRecoveryProposals.listOpen(published.documentId),
    };
  }

  it('stops the run on the renamed element and proposes what replaced it', async () => {
    const outcome = await runAgainstTheDriftedPage({ recoveryAllowed: true });

    // 1. The run failed. It was not rescued, retried, or quietly redirected
    //    through the fallback locator — which is the line ADR-033 draws.
    expect(outcome.result.status).toBe('failed');
    expect(outcome.result.error?.code).toBe('UNEXPECTED_UI_STATE');
    expect(outcome.result.error?.message).toContain(RECORDED_TEST_ID);

    // 2. And it said so in the run's own evidence.
    const proposed = outcome.events.find((event) => event.eventType === 'recovery.proposed');
    expect(proposed).toBeDefined();
    expect(proposed?.agentStepId).toBe(DRIFTED_STEP);

    // 3. The proposal is about the document, and names the surviving locator.
    expect(outcome.proposals).toHaveLength(1);

    const proposal = outcome.proposals[0]!;
    expect(proposal.stepId).toBe(DRIFTED_STEP);
    expect(proposal.state).toBe('proposed');
    expect(proposal.deterministic).toBe(true);
    expect(proposal.diagnosis['confidence']).toBe('high');
    expect(proposal.observedInRunId).toBe(outcome.result.runId);

    const body = proposal.proposedBinding.body;
    expect(body.kind).toBe('click');
    expect(body.kind !== 'decision' && body.target.selectors[0]).toEqual({
      strategy: 'role_and_name',
      value: 'button',
      name: 'Search',
    });
  }, 180_000);

  it('leaves the approved binding exactly as it was until a person accepts', async () => {
    const outcome = await runAgainstTheDriftedPage({ recoveryAllowed: true });
    const repositories = createRepositories(getDatabase().db);

    const current = await repositories.executionBindings.findCurrent(
      outcome.documentId,
      DRIFTED_STEP,
    );

    // Still approved, still current, still naming the test id that stopped
    // working. Orbit has an opinion and no authority.
    expect(current?.state).toBe('approved');
    expect(
      current?.binding.body.kind !== 'decision' && current?.binding.body.target.selectors[0]?.value,
    ).toBe(RECORDED_TEST_ID);

    // Accepting is the whole of what changes it, and it goes through the
    // ordinary lifecycle: the new binding is approved and supersedes the old.
    const accepted = await acceptRecoveryProposal({
      database: getDatabase().db,
      proposalId: outcome.proposals[0]!.id,
    });

    expect(accepted.ok).toBe(true);

    const replaced = await repositories.executionBindings.findCurrent(
      outcome.documentId,
      DRIFTED_STEP,
    );

    expect(replaced?.state).toBe('approved');
    expect(
      replaced?.binding.body.kind !== 'decision' &&
        replaced?.binding.body.target.selectors[0]?.strategy,
    ).toBe('role_and_name');
    expect((await repositories.executionBindings.findById(current!.id))?.state).toBe('superseded');
  }, 180_000);

  it('proposes nothing at all for a workflow that was never granted recovery', async () => {
    // The trust-tier gate, against the same real drift. The run fails
    // identically; what is missing is any opinion about it.
    const outcome = await runAgainstTheDriftedPage({ recoveryAllowed: false });

    expect(outcome.result.status).toBe('failed');
    expect(outcome.result.error?.code).toBe('UNEXPECTED_UI_STATE');
    expect(outcome.proposals).toHaveLength(0);
    expect(outcome.events.some((event) => event.eventType.startsWith('recovery.'))).toBe(false);
  }, 180_000);
});
