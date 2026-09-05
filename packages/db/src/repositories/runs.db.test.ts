import { newRunStepId, type OrbitError } from '@orbit/contracts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  InvalidRunTransitionError,
  RecordNotFoundError,
  isUniqueViolation,
  violatedConstraint,
} from '../errors';
import { runSteps } from '../schema';
import {
  FOUND_INPUTS,
  FOUND_OUTPUTS,
  NOT_FOUND_INPUTS,
  TEST_TRIGGER,
  createTestRun,
  seedTestAgentVersion,
} from '../testing/factories';
import { useTestDatabase } from '../testing/harness';
import { createRepositories, withTransaction } from './index';

const testDatabase = useTestDatabase();

describe('runs', () => {
  it('creates a run pinned to one exact agent version', async () => {
    const { db } = testDatabase();
    const agentVersion = await seedTestAgentVersion(db);

    const run = await createTestRun(db, agentVersion.id);

    expect(run.agentVersionId).toBe(agentVersion.id);
    expect(run.id).toMatch(/^run_/);
    expect(run.status).toBe('queued');
    expect(run.businessOutcome).toBe('none');
    expect(run.queuedAt).toBeInstanceOf(Date);
    expect(run.startedAt).toBeNull();
    expect(run.finishedAt).toBeNull();
  });

  it('round trips trigger metadata and validated inputs', async () => {
    const { db } = testDatabase();
    const agentVersion = await seedTestAgentVersion(db);
    const created = await createTestRun(db, agentVersion.id);

    const run = await createRepositories(db).runs.findById(created.id);

    expect(run?.inputs).toEqual(FOUND_INPUTS);
    expect(run?.trigger).toEqual(TEST_TRIGGER);
    expect(run?.trigger.actor.id).toBe('dev-user');
  });

  it('refuses a run that references an agent version that does not exist', async () => {
    const { db } = testDatabase();

    await expect(
      createRepositories(db).runs.create({
        agentVersionId: 'agentv_missing' as never,
        trigger: TEST_TRIGGER,
        inputs: FOUND_INPUTS,
      }),
    ).rejects.toThrow();
  });

  it('records the found outcome with its extracted outputs', async () => {
    const { db } = testDatabase();
    const repositories = createRepositories(db);
    const agentVersion = await seedTestAgentVersion(db);
    const created = await createTestRun(db, agentVersion.id);

    await repositories.runs.markRunning(created.id);
    const completed = await repositories.runs.complete(created.id, {
      businessOutcome: 'request_found',
      outputs: FOUND_OUTPUTS,
    });

    expect(completed.status).toBe('succeeded');
    expect(completed.businessOutcome).toBe('request_found');
    expect(completed.outputs).toEqual(FOUND_OUTPUTS);
    expect(completed.startedAt).toBeInstanceOf(Date);
    expect(completed.finishedAt).toBeInstanceOf(Date);
    expect(completed.error).toBeNull();
  });

  it('treats a not-found request as a successful run, not a failure', async () => {
    const { db } = testDatabase();
    const repositories = createRepositories(db);
    const agentVersion = await seedTestAgentVersion(db);
    const created = await createTestRun(db, agentVersion.id, NOT_FOUND_INPUTS);

    await repositories.runs.markRunning(created.id);
    const completed = await repositories.runs.complete(created.id, {
      businessOutcome: 'request_not_found',
      outputs: { requestNumber: 'SR-9999' },
    });

    // ADR-006: technical status and business outcome are separate concepts.
    expect(completed.status).toBe('succeeded');
    expect(completed.businessOutcome).toBe('request_not_found');
    expect(completed.error).toBeNull();
  });

  it('records a typed error on a technical failure', async () => {
    const { db } = testDatabase();
    const repositories = createRepositories(db);
    const agentVersion = await seedTestAgentVersion(db);
    const created = await createTestRun(db, agentVersion.id);

    const error: OrbitError = {
      code: 'LOCATOR_NOT_FOUND',
      message: 'The search button was not found within 15000ms.',
      details: [{ field: 'locator.value', message: 'search-request-button' }],
    };

    await repositories.runs.markRunning(created.id);
    const failed = await repositories.runs.fail(created.id, { error });

    expect(failed.status).toBe('failed');
    // A technical failure reached no business conclusion.
    expect(failed.businessOutcome).toBe('none');
    expect(failed.error).toEqual(error);
    expect(failed.finishedAt).toBeInstanceOf(Date);
  });

  it('rejects an illegal status transition instead of overwriting a terminal run', async () => {
    const { db } = testDatabase();
    const repositories = createRepositories(db);
    const agentVersion = await seedTestAgentVersion(db);
    const created = await createTestRun(db, agentVersion.id);

    await repositories.runs.markRunning(created.id);
    await repositories.runs.complete(created.id, {
      businessOutcome: 'request_found',
      outputs: FOUND_OUTPUTS,
    });

    await expect(
      repositories.runs.complete(created.id, {
        businessOutcome: 'request_not_found',
        outputs: {},
      }),
    ).rejects.toThrow(InvalidRunTransitionError);

    await expect(repositories.runs.markRunning(created.id)).rejects.toThrow(
      InvalidRunTransitionError,
    );

    const unchanged = await repositories.runs.findById(created.id);
    expect(unchanged?.businessOutcome).toBe('request_found');
  });

  it('distinguishes a missing run from an illegal transition', async () => {
    const repositories = createRepositories(testDatabase().db);
    await expect(repositories.runs.markRunning('run_missing' as never)).rejects.toThrow(
      RecordNotFoundError,
    );
  });

  it('lists runs for an agent version, newest first', async () => {
    const { db } = testDatabase();
    const repositories = createRepositories(db);
    const agentVersion = await seedTestAgentVersion(db);

    const older = await repositories.runs.create({
      agentVersionId: agentVersion.id,
      trigger: TEST_TRIGGER,
      inputs: FOUND_INPUTS,
      queuedAt: new Date('2026-09-05T15:00:00.000Z'),
    });
    const newer = await repositories.runs.create({
      agentVersionId: agentVersion.id,
      trigger: TEST_TRIGGER,
      inputs: NOT_FOUND_INPUTS,
      queuedAt: new Date('2026-09-05T16:00:00.000Z'),
    });

    const runs = await repositories.runs.listByAgentVersion(agentVersion.id);
    expect(runs.map((run) => run.id)).toEqual([newer.id, older.id]);
  });
});

describe('run steps', () => {
  it('allocates a gapless execution sequence and returns steps in that order', async () => {
    const { db } = testDatabase();
    const repositories = createRepositories(db);
    const agentVersion = await seedTestAgentVersion(db);
    const run = await createTestRun(db, agentVersion.id);

    const agentStepIds = [
      'open_request_portal',
      'enter_request_number',
      'submit_request_search',
      'detect_request_result',
    ];

    for (const agentStepId of agentStepIds) {
      await repositories.runSteps.start({ runId: run.id, agentStepId, stepType: 'browser.click' });
    }

    const steps = await repositories.runSteps.listByRun(run.id);

    expect(steps.map((step) => step.sequence)).toEqual([1, 2, 3, 4]);
    expect(steps.map((step) => step.agentStepId)).toEqual(agentStepIds);
    expect(steps.every((step) => step.attempt === 1)).toBe(true);
  });

  it('persists safe step output and completes the step', async () => {
    const { db } = testDatabase();
    const repositories = createRepositories(db);
    const agentVersion = await seedTestAgentVersion(db);
    const run = await createTestRun(db, agentVersion.id);

    const step = await repositories.runSteps.start({
      runId: run.id,
      agentStepId: 'extract_request_data',
      stepType: 'browser.extract',
    });

    expect(step.status).toBe('running');

    const completed = await repositories.runSteps.complete(step.id, {
      output: { requestStatus: 'In Progress', assignedTeam: 'Infrastructure Operations' },
    });

    expect(completed.status).toBe('succeeded');
    expect(completed.output).toEqual({
      requestStatus: 'In Progress',
      assignedTeam: 'Infrastructure Operations',
    });
    expect(completed.finishedAt).toBeInstanceOf(Date);
  });

  it('persists a typed step error', async () => {
    const { db } = testDatabase();
    const repositories = createRepositories(db);
    const agentVersion = await seedTestAgentVersion(db);
    const run = await createTestRun(db, agentVersion.id);

    const step = await repositories.runSteps.start({
      runId: run.id,
      agentStepId: 'submit_request_search',
      stepType: 'browser.click',
    });

    const failed = await repositories.runSteps.fail(step.id, {
      error: { code: 'LOCATOR_NOT_FOUND', message: 'search-request-button was not visible.' },
    });

    expect(failed.status).toBe('failed');
    expect(failed.error?.code).toBe('LOCATOR_NOT_FOUND');
  });

  it('rejects a duplicate execution sequence within a run', async () => {
    const { db } = testDatabase();
    const repositories = createRepositories(db);
    const agentVersion = await seedTestAgentVersion(db);
    const run = await createTestRun(db, agentVersion.id);

    await repositories.runSteps.start({
      runId: run.id,
      agentStepId: 'open_request_portal',
      stepType: 'browser.navigate',
    });

    const error = await db
      .insert(runSteps)
      .values({
        id: newRunStepId(),
        runId: run.id,
        agentStepId: 'enter_request_number',
        stepType: 'browser.fill',
        sequence: 1,
        status: 'running',
      })
      .catch((caught: unknown) => caught);

    expect(isUniqueViolation(error)).toBe(true);
    expect(violatedConstraint(error)).toBe('run_steps_run_id_sequence_unique');
  });

  it('rejects re-executing the same agent step on the same attempt', async () => {
    const { db } = testDatabase();
    const repositories = createRepositories(db);
    const agentVersion = await seedTestAgentVersion(db);
    const run = await createTestRun(db, agentVersion.id);

    await repositories.runSteps.start({
      runId: run.id,
      agentStepId: 'open_request_portal',
      stepType: 'browser.navigate',
    });

    const error = await repositories.runSteps
      .start({ runId: run.id, agentStepId: 'open_request_portal', stepType: 'browser.navigate' })
      .catch((caught: unknown) => caught);

    expect(violatedConstraint(error)).toBe('run_steps_run_id_agent_step_id_attempt_unique');
  });

  it('permits the same agent step on a later attempt, which retries will need', async () => {
    const { db } = testDatabase();
    const repositories = createRepositories(db);
    const agentVersion = await seedTestAgentVersion(db);
    const run = await createTestRun(db, agentVersion.id);

    const first = await repositories.runSteps.start({
      runId: run.id,
      agentStepId: 'submit_request_search',
      stepType: 'browser.click',
    });
    const second = await repositories.runSteps.start({
      runId: run.id,
      agentStepId: 'submit_request_search',
      stepType: 'browser.click',
      attempt: 2,
    });

    expect(first.attempt).toBe(1);
    expect(second.attempt).toBe(2);
    expect(second.sequence).toBe(2);
  });

  it('leaves no step row and no consumed sequence when the insert is rejected', async () => {
    const { db } = testDatabase();
    const repositories = createRepositories(db);
    const agentVersion = await seedTestAgentVersion(db);
    const run = await createTestRun(db, agentVersion.id);

    await repositories.runSteps.start({
      runId: run.id,
      agentStepId: 'open_request_portal',
      stepType: 'browser.navigate',
    });

    await repositories.runSteps
      .start({ runId: run.id, agentStepId: 'open_request_portal', stepType: 'browser.navigate' })
      .catch(() => undefined);

    // The rejected attempt rolled back its sequence allocation with it.
    const next = await repositories.runSteps.start({
      runId: run.id,
      agentStepId: 'enter_request_number',
      stepType: 'browser.fill',
    });

    expect(next.sequence).toBe(2);
    expect(await db.select().from(runSteps).where(eq(runSteps.runId, run.id))).toHaveLength(2);
  });
});

describe('transaction composition', () => {
  it('creates a run and its queued event atomically', async () => {
    const { db } = testDatabase();
    const agentVersion = await seedTestAgentVersion(db);

    const run = await withTransaction(db, async (repositories) => {
      const created = await repositories.runs.create({
        agentVersionId: agentVersion.id,
        trigger: TEST_TRIGGER,
        inputs: FOUND_INPUTS,
      });

      await repositories.runEvents.append({
        runId: created.id,
        agentVersionId: agentVersion.id,
        eventType: 'run.queued',
        payload: { trigger: 'watchtower_manual' },
      });

      return created;
    });

    const events = await createRepositories(db).runEvents.listByRun(run.id);
    expect(events.map((event) => event.eventType)).toEqual(['run.queued']);
  });

  it('rolls the whole unit of work back when any part fails', async () => {
    const { db } = testDatabase();
    const repositories = createRepositories(db);
    const agentVersion = await seedTestAgentVersion(db);

    await expect(
      withTransaction(db, async (transactional) => {
        await transactional.runs.create({
          agentVersionId: agentVersion.id,
          trigger: TEST_TRIGGER,
          inputs: FOUND_INPUTS,
        });

        throw new Error('the runtime failed after creating the run');
      }),
    ).rejects.toThrow('the runtime failed after creating the run');

    expect(await repositories.runs.listByAgentVersion(agentVersion.id)).toHaveLength(0);
  });
});
