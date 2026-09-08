import { createLocalFilesystemArtifactStorage, type ArtifactStorage } from '@orbit/artifacts';
import { createTestArtifactRoot, removeTestArtifactRoot } from '@orbit/artifacts/testing';
import type { AgentIr } from '@orbit/agent-ir';
import { judgedAvailabilityBindings } from '@orbit/agent-ir-compiler/testing';
import { compileCandidate } from '@orbit/agent-ir-compiler';
import { judgedAvailabilityGraph } from '@orbit/sop-graph/testing';
import { publishedDocumentFor } from '@orbit/sop-service';
import { createRepositories } from '@orbit/db';
import { TEST_TRIGGER, useTestDatabase } from '@orbit/db/testing';
import { createPlaywrightExecutorFactory } from '@orbit/executor-playwright';
import { executeAgentVersion } from '@orbit/runtime';
import { createDatabaseRunStore } from '@orbit/runtime/persistence';
import {
  adoptedProcess,
  createFakeJudge,
  isHttpReady,
  startManagedProcess,
  waitForHttpReady,
  type ManagedProcess,
} from '@orbit/runtime/testing';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * A judged decision, executed against a real browser and a real page.
 *
 * This is the claim the whole sub-phase rests on, checked rather than asserted:
 * live page text reaches the judge through the ordinary `browser.extract`
 * capability, the judge returns an index, and the run takes the branch that
 * index names — while nothing the judge produced becomes a locator, a URL, or a
 * step id.
 *
 * **No model is called.** The judge is the deterministic fake, deciding from
 * the text it is handed. That is deliberate and it is not a weaker test: what
 * needs proving here is the *path* — real portal, real Playwright, real
 * `readText`, real branch, real evidence — and a real model would make the test
 * non-deterministic, slow, and expensive while proving nothing extra about the
 * plumbing. Whether Claude classifies "On loan · due 2024-06-20" correctly is a
 * question about a model, not about Orbit.
 *
 * The interesting contrast with `library-borrow-or-hold.runtime.test.ts` is the
 * third case: the catalog says "On hold", a state the deterministic workflow's
 * bound Borrow button never distinguished, and the judged one classifies from
 * the same words a person would read.
 */

const LIBRARY_PORTAL_URL = 'http://localhost:3020/catalog';
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Rendered as "Available". */
const AVAILABLE_ISBN = '978-0-13-235088-4';

/** Rendered as "On loan · due 2024-06-20" — the same meaning, a different surface. */
const ON_LOAN_ISBN = '978-0-201-63361-0';

/** Rendered as "On hold". A third wording, and no bound element distinguishes it. */
const ON_HOLD_ISBN = '978-0-13-595705-9';

const MEMBER_ID = 'LIB-1001';

/**
 * A judge that reads the words, deterministically.
 *
 * It classifies the real status text the real page rendered. Two runs give the
 * same answer, which a model would not guarantee — that difference is the
 * subject of ADR-032 rather than something this test should be exposed to.
 */
function statusJudge() {
  return createFakeJudge({
    confidence: 0.95,
    rationale: 'classified from the availability status region',
    decide: (request) => {
      const text = request.sources
        .map((source) => source.text)
        .join(' ')
        .toLowerCase();

      if (text.includes('available')) {
        return 0;
      }
      if (text.includes('on loan') || text.includes('on hold')) {
        return 1;
      }
      return 2; // The insufficient-evidence alternative.
    },
  });
}

describe('a judged decision against the real library portal', () => {
  const getDatabase = useTestDatabase();

  let artifactRoot: string;
  let storage: ArtifactStorage;
  let portal: ManagedProcess;
  let startedPortal = false;
  let agentIr: AgentIr;

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

    const compiled = compileCandidate({
      graph: judgedAvailabilityGraph(),
      bindings: judgedAvailabilityBindings(),
      agentId: 'agent_judged_availability',
      version: '0.1.0',
      sopId: 'sop_judged_availability',
      sopVersion: '1',
    });

    if (!compiled.ok) {
      throw new Error(`the judged workflow did not compile: ${JSON.stringify(compiled.refusals)}`);
    }

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
    const judge = statusJudge();

    const result = await executeAgentVersion({
      agentVersionId: agentVersion.id,
      agentIr: agentVersion.agentIr,
      inputs: { bookIsbn, memberId: MEMBER_ID },
      trigger: TEST_TRIGGER,
      store: createDatabaseRunStore({ database: getDatabase().db, storage }),
      executors: { browser: { open: () => factory.open() } },
      judge,
    });

    const steps = await repositories.runSteps.listByRun(result.runId);
    const events = await repositories.runEvents.listByRun(result.runId);

    return {
      run: await repositories.runs.findById(result.runId),
      steps,
      events,
      judge,
      decision: steps.find((step) => step.agentStepId === 'check_availability'),
      ranStepIds: steps.map((step) => step.agentStepId),
    };
  }

  it('borrows a title the page describes as available', async () => {
    const { run: record, decision, ranStepIds, judge } = await run(AVAILABLE_ISBN);

    expect(record?.status).toBe('succeeded');
    expect(record?.businessOutcome).toBe('borrowed');

    // The judge saw the real text the real page rendered, through the ordinary
    // executor. This is the line that makes it an integration test.
    expect(judge.requests[0]?.sources[0]?.text).toContain('Available');

    expect(decision?.output).toMatchObject({
      chosenIndex: 0,
      chosenOutcome: 'a_copy_can_be_borrowed_right_now',
      next: 'enter_borrow_member_id',
    });

    expect(ranStepIds).toContain('borrow_title');
    expect(ranStepIds).not.toContain('place_hold');
  }, 180_000);

  it('places a hold on a title the page describes as on loan', async () => {
    const { run: record, decision, ranStepIds, judge } = await run(ON_LOAN_ISBN);

    expect(record?.status).toBe('succeeded');
    expect(record?.businessOutcome).toBe('held');

    // A different wording — with a due date appended — for the same meaning.
    expect(judge.requests[0]?.sources[0]?.text).toContain('On loan');

    expect(decision?.output).toMatchObject({ chosenIndex: 1, next: 'enter_hold_member_id' });
    expect(ranStepIds).toContain('place_hold');
  }, 180_000);

  /**
   * The third wording, and the limitation it exposes.
   *
   * "On hold" is a case the deterministic workflow could not express at all,
   * and the judged one classifies it correctly from the words: no copy can be
   * borrowed right now, which is true. The run then fails — because the branch
   * behind that classification assumes a *hold form*, and the catalog renders
   * one for a title on loan but not for one already on hold.
   *
   * That is an author error, not a runtime bug, and it is the sibling of the
   * overlapping-categories problem in ADR-032: the classification is a correct
   * partition of the *question*, and a wrong partition of what the workflow can
   * then *do*. Nothing in the schema can detect it, because both facts live in
   * the author's head. This test pins the real behaviour rather than choosing
   * an ISBN that hides it: the judgement is right, the workflow is wrong, and
   * the evidence says exactly where.
   */
  it('classifies a third wording correctly, and fails visibly where the branch assumed too much', async () => {
    const { run: record, judge, decision, steps } = await run(ON_HOLD_ISBN);

    // The judge saw the real words and drew the right conclusion.
    expect(judge.requests[0]?.sources[0]?.text).toContain('On hold');
    expect(decision?.output).toMatchObject({
      chosenOutcome: 'no_copy_can_be_borrowed_right_now',
      next: 'enter_hold_member_id',
    });
    expect(decision?.status).toBe('succeeded');

    // And the workflow then failed at the step that assumed a hold form, with a
    // typed error naming it — not silently, and not on the decision.
    expect(record?.status).toBe('failed');

    const failed = steps.find((step) => step.status === 'failed');
    expect(failed?.agentStepId).toBe('enter_hold_member_id');
    expect(failed?.error?.code).toBeDefined();
  }, 180_000);

  it('records the whole decision, reconstructable from the database alone', async () => {
    const { run: record, events, decision } = await run(AVAILABLE_ISBN);

    const requested = events.find((event) => event.eventType === 'decision.requested');
    const resolved = events.find((event) => event.eventType === 'decision.resolved');

    expect(requested?.payload).toMatchObject({
      alternatives: [
        'a_copy_can_be_borrowed_right_now',
        'no_copy_can_be_borrowed_right_now',
        'the_page_does_not_say_whether_a_copy_can_be_borrowed',
      ],
      confidenceThreshold: 0.8,
    });

    expect(resolved?.payload).toMatchObject({ chosenOutcome: 'a_copy_can_be_borrowed_right_now' });

    // And what the judge was shown is an artifact, not just a claim in a payload.
    const repositories = createRepositories(getDatabase().db);
    const artifacts = await repositories.artifacts.listByRun(record!.id);

    expect(artifacts.some((artifact) => artifact.kind === 'decision_input')).toBe(true);
    expect(decision?.status).toBe('succeeded');
  }, 180_000);

  it('halts the run when no judge is wired, rather than skipping the decision', async () => {
    const repositories = createRepositories(getDatabase().db);
    await repositories.agents.upsert({ id: agentIr.id, name: agentIr.name });
    const agentVersion = await repositories.agentVersions.create({ agentIr });
    const factory = createPlaywrightExecutorFactory({ headless: true });

    const result = await executeAgentVersion({
      agentVersionId: agentVersion.id,
      agentIr: agentVersion.agentIr,
      inputs: { bookIsbn: AVAILABLE_ISBN, memberId: MEMBER_ID },
      trigger: TEST_TRIGGER,
      store: createDatabaseRunStore({ database: getDatabase().db, storage }),
      executors: { browser: { open: () => factory.open() } },
      // No judge.
    });

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('DECISION_JUDGE_UNAVAILABLE');
  }, 180_000);
});
