import { createLocalFilesystemArtifactStorage, type ArtifactStorage } from '@orbit/artifacts';
import { createTestArtifactRoot, removeTestArtifactRoot } from '@orbit/artifacts/testing';
import type { AgentIr } from '@orbit/agent-ir';
import {
  BORROW_OR_HOLD_OUTCOME_MAPPING,
  borrowOrHoldBindings,
  borrowOrHoldGraph,
} from '@orbit/agent-ir-compiler/testing';
import { compileCandidate } from '@orbit/agent-ir-compiler';
import { publishedDocumentFor } from '@orbit/sop-service';
import { createRepositories } from '@orbit/db';
import { TEST_TRIGGER, useTestDatabase } from '@orbit/db/testing';
import { createPlaywrightExecutorFactory } from '@orbit/executor-playwright';
import { executeAgentVersion } from '@orbit/runtime';
import { createDatabaseRunStore } from '@orbit/runtime/persistence';
import {
  adoptedProcess,
  isHttpReady,
  startManagedProcess,
  waitForHttpReady,
  type ManagedProcess,
} from '@orbit/runtime/testing';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Branching, executed.
 *
 * The proof that a `decision` step reaches a real browser and takes the right
 * turn. It compiles the borrow-or-hold workflow from its graph and its
 * demonstrated bindings, publishes it, and runs it twice against the real
 * library portal — once on a title that is available, once on one that is out —
 * asserting each run took the branch it should have.
 *
 * Nothing in `packages/runtime`, `packages/agent-ir` or
 * `packages/executor-playwright` was changed to make this work. Branching was
 * already there: `browser.expect_one_of` waits for whichever of several known
 * states appears and jumps to that alternative's `next`. What was missing was a
 * binding shape that could say what each branch *looks like*, which is what
 * this task added (ADR-029). This test is where that claim is checked rather
 * than asserted.
 *
 * The library portal is started here rather than in the shared global setup so
 * that `packages/runtime` stays untouched, which the task this came from
 * required.
 */

const LIBRARY_PORTAL_URL = 'http://localhost:3020/catalog';
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Available in the seeded catalog, so the workflow should borrow it. */
const AVAILABLE_ISBN = '978-0-13-235088-4';

/** On loan in the seeded catalog, so the workflow should place a hold. */
const ON_LOAN_ISBN = '978-0-201-63361-0';

/** A member in good standing — no fines, under the loan cap, not suspended. */
const MEMBER_ID = 'LIB-1001';

describe('a branching workflow against the real library portal', () => {
  const getDatabase = useTestDatabase();

  let artifactRoot: string;
  let storage: ArtifactStorage;
  let portal: ManagedProcess;
  let startedPortal = false;
  let agentIr: AgentIr;

  beforeAll(async () => {
    // Reused when one is already listening, exactly as the demo portal is, so
    // running this alongside `pnpm dev` does not fight it. Only a portal this
    // run started is stopped again.
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

    const compiled = compileCandidate({
      graph: borrowOrHoldGraph(),
      bindings: borrowOrHoldBindings(),
      outcomeMapping: BORROW_OR_HOLD_OUTCOME_MAPPING,
      agentId: 'agent_borrow_or_hold',
      version: '0.1.0',
      sopId: 'sop_borrow_or_hold',
      sopVersion: '1',
    });

    if (!compiled.ok) {
      throw new Error(`the demo workflow did not compile: ${JSON.stringify(compiled.refusals)}`);
    }

    // Published through the same function the publish pipeline uses, rather
    // than by hand: the runtime executes only a published version, and forcing
    // the field here would test a document nothing else could produce.
    agentIr = publishedDocumentFor(compiled.agentIr, '0.1.0');
  }, 180_000);

  afterAll(async () => {
    await removeTestArtifactRoot(artifactRoot);

    if (startedPortal) {
      await portal.stop();
    }
  });

  async function run(bookIsbn: string) {
    const repositories = createRepositories(getDatabase().db);
    await repositories.agents.upsert({ id: agentIr.id, name: agentIr.name });
    const agentVersion = await repositories.agentVersions.create({ agentIr });

    const factory = createPlaywrightExecutorFactory({ headless: true });

    const result = await executeAgentVersion({
      agentVersionId: agentVersion.id,
      agentIr: agentVersion.agentIr,
      inputs: { bookIsbn, memberId: MEMBER_ID },
      trigger: TEST_TRIGGER,
      store: createDatabaseRunStore({ database: getDatabase().db, storage }),
      browser: { open: () => factory.open() },
    });

    const steps = await repositories.runSteps.listByRun(result.runId);

    return {
      run: await repositories.runs.findById(result.runId),
      steps,
      decision: steps.find((step) => step.agentStepId === 'check_availability'),
      ranStepIds: steps.map((step) => step.agentStepId),
    };
  }

  it('borrows a title that is available, taking the first branch', async () => {
    const { run: record, decision, ranStepIds } = await run(AVAILABLE_ISBN);

    expect(record?.status).toBe('succeeded');
    expect(record?.businessOutcome).toBe('request_found');

    // The decision resolved to alternative 0 — the Borrow button — which is the
    // whole claim: the runtime chose by what was on screen, not by step order.
    expect(decision?.output).toMatchObject({
      selectedAlternativeIndex: 0,
      next: 'enter_borrow_member_id',
    });

    // And the branch it did not take never ran.
    expect(ranStepIds).toContain('borrow_title');
    expect(ranStepIds).not.toContain('place_hold');

    expect(record?.outputs?.['borrowConfirmation']).toContain('Borrowed by');
  }, 180_000);

  it('places a hold on a title that is out, taking the second branch', async () => {
    const { run: record, decision, ranStepIds } = await run(ON_LOAN_ISBN);

    expect(record?.status).toBe('succeeded');
    expect(record?.businessOutcome).toBe('request_not_found');

    expect(decision?.output).toMatchObject({
      selectedAlternativeIndex: 1,
      next: 'enter_hold_member_id',
    });

    expect(ranStepIds).toContain('place_hold');
    expect(ranStepIds).not.toContain('borrow_title');

    expect(record?.outputs?.['holdConfirmation']).toContain('in line for this title');
  }, 180_000);
});
