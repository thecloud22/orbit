import { newArtifactLinkId } from '@orbit/contracts';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { violatedConstraint } from '../errors';
import { artifactLinks, artifacts, runEvents, runSteps, runs } from '../schema';
import { createTestRun, seedTestAgentVersion } from '../testing/factories';
import { useTestDatabase } from '../testing/harness';
import { createRepositories } from './index';

const testDatabase = useTestDatabase();

const SCREENSHOT_SHA = 'a'.repeat(64);
const DOM_SHA = 'b'.repeat(64);
const TRACE_SHA = 'c'.repeat(64);

async function evidenceContext() {
  const { db } = testDatabase();
  const repositories = createRepositories(db);
  const agentVersion = await seedTestAgentVersion(db);
  const run = await createTestRun(db, agentVersion.id);

  const step = await repositories.runSteps.start({
    runId: run.id,
    agentStepId: 'submit_request_search',
    stepType: 'browser.click',
  });

  const event = await repositories.runEvents.append({
    runId: run.id,
    agentVersionId: agentVersion.id,
    runStepId: step.id,
    agentStepId: 'submit_request_search',
    eventType: 'browser.click.completed',
  });

  return { db, repositories, agentVersion, run, step, event };
}

describe('artifact metadata', () => {
  it('persists metadata without any binary bytes', async () => {
    const { repositories, run, step } = await evidenceContext();

    const artifact = await repositories.artifacts.create({
      runId: run.id,
      runStepId: step.id,
      kind: 'browser_screenshot',
      contentType: 'image/png',
      storageKey: `runs/${run.id}/steps/submit_request_search/after.png`,
      sizeBytes: 12_345,
      sha256: SCREENSHOT_SHA,
    });

    expect(artifact.id).toMatch(/^art_/);
    expect(artifact.kind).toBe('browser_screenshot');
    expect(artifact.storageKey).toContain('after.png');
    expect(artifact.sizeBytes).toBe(12_345);
    expect(artifact.sha256).toBe(SCREENSHOT_SHA);
    expect(artifact.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it('has no binary column anywhere in the schema', async () => {
    const { rows } = await testDatabase().db.execute<{ table_name: string; column_name: string }>(
      sql`select table_name, column_name from information_schema.columns
          where table_schema = 'public' and data_type in ('bytea', 'blob')`,
    );

    // ADR-004 and ADR-010: bytes live in artifact storage, never in PostgreSQL.
    expect(rows).toEqual([]);
  });

  it('rejects a duplicate storage key, so two artifacts cannot claim one file', async () => {
    const { repositories, run } = await evidenceContext();

    const input = {
      runId: run.id,
      kind: 'browser_trace' as const,
      contentType: 'application/zip',
      storageKey: `runs/${run.id}/trace.zip`,
      sizeBytes: 4_096,
      sha256: TRACE_SHA,
    };

    await repositories.artifacts.create(input);
    const error = await repositories.artifacts.create(input).catch((caught: unknown) => caught);

    expect(violatedConstraint(error)).toBe('artifacts_storage_key_unique');
  });

  it('rejects an empty storage key and a malformed digest', async () => {
    const { repositories, run } = await evidenceContext();

    const emptyKey = await repositories.artifacts
      .create({
        runId: run.id,
        kind: 'dom_snapshot',
        contentType: 'text/html',
        storageKey: '',
        sizeBytes: 10,
        sha256: DOM_SHA,
      })
      .catch((caught: unknown) => caught);

    expect(violatedConstraint(emptyKey)).toBe('artifacts_storage_key_check');

    const badDigest = await repositories.artifacts
      .create({
        runId: run.id,
        kind: 'dom_snapshot',
        contentType: 'text/html',
        storageKey: `runs/${run.id}/dom.html`,
        sizeBytes: 10,
        sha256: 'NOT-A-DIGEST',
      })
      .catch((caught: unknown) => caught);

    expect(violatedConstraint(badDigest)).toBe('artifacts_sha256_check');
  });

  it('lists artifacts by run and by step', async () => {
    const { repositories, run, step } = await evidenceContext();

    await repositories.artifacts.create({
      runId: run.id,
      runStepId: step.id,
      kind: 'browser_screenshot',
      contentType: 'image/png',
      storageKey: `runs/${run.id}/steps/click/after.png`,
      sizeBytes: 1,
      sha256: SCREENSHOT_SHA,
    });
    await repositories.artifacts.create({
      runId: run.id,
      kind: 'browser_trace',
      contentType: 'application/zip',
      storageKey: `runs/${run.id}/trace.zip`,
      sizeBytes: 2,
      sha256: TRACE_SHA,
    });

    expect(await repositories.artifacts.listByRun(run.id)).toHaveLength(2);

    const stepArtifacts = await repositories.artifacts.listByStep(step.id);
    expect(stepArtifacts).toHaveLength(1);
    expect(stepArtifacts[0]?.kind).toBe('browser_screenshot');
  });
});

describe('artifact links', () => {
  it('links one artifact to a run, a step, and an event with distinct roles', async () => {
    const { repositories, run, step, event } = await evidenceContext();

    const { artifact, links } = await repositories.artifacts.createWithLinks(
      {
        runId: run.id,
        runStepId: step.id,
        kind: 'browser_screenshot',
        contentType: 'image/png',
        storageKey: `runs/${run.id}/steps/click/after.png`,
        sizeBytes: 512,
        sha256: SCREENSHOT_SHA,
      },
      [
        { role: 'screenshot_after_action', targetType: 'run_step', targetId: step.id },
        { role: 'screenshot_after_action', targetType: 'run_event', targetId: event.id },
        { role: 'error_context', targetType: 'run', targetId: run.id },
      ],
    );

    expect(links).toHaveLength(3);

    const forRun = await repositories.artifacts.listLinksForRun(run.id);
    expect(forRun).toHaveLength(1);
    expect(forRun[0]?.targetType).toBe('run');
    expect(forRun[0]?.role).toBe('error_context');
    expect(forRun[0]?.artifactId).toBe(artifact.id);

    const forStep = await repositories.artifacts.listLinksForStep(step.id);
    expect(forStep).toHaveLength(1);
    expect(forStep[0]?.targetType).toBe('run_step');
    expect(forStep[0]?.targetId).toBe(step.id);

    const forArtifact = await repositories.artifacts.listLinksForArtifact(artifact.id);
    expect(forArtifact).toHaveLength(3);
  });

  it('surfaces event-targeted links as the event envelope artifact refs', async () => {
    const { repositories, run, step, event } = await evidenceContext();

    const { artifact } = await repositories.artifacts.createWithLinks(
      {
        runId: run.id,
        runStepId: step.id,
        kind: 'dom_snapshot',
        contentType: 'text/html',
        storageKey: `runs/${run.id}/steps/click/after.html`,
        sizeBytes: 2_048,
        sha256: DOM_SHA,
      },
      [{ role: 'dom_snapshot', targetType: 'run_event', targetId: event.id }],
    );

    const [envelope] = await repositories.runEvents.listByRun(run.id);

    expect(envelope?.artifactRefs).toEqual([artifact.id]);
  });

  it('requires exactly one target', async () => {
    const { db, repositories, run, step } = await evidenceContext();

    const artifact = await repositories.artifacts.create({
      runId: run.id,
      kind: 'browser_trace',
      contentType: 'application/zip',
      storageKey: `runs/${run.id}/trace.zip`,
      sizeBytes: 8,
      sha256: TRACE_SHA,
    });

    const noTarget = await db
      .insert(artifactLinks)
      .values({ id: newArtifactLinkId(), artifactId: artifact.id, role: 'browser_trace' })
      .catch((caught: unknown) => caught);

    expect(violatedConstraint(noTarget)).toBe('artifact_links_exactly_one_target_check');

    const twoTargets = await db
      .insert(artifactLinks)
      .values({
        id: newArtifactLinkId(),
        artifactId: artifact.id,
        role: 'browser_trace',
        runId: run.id,
        runStepId: step.id,
      })
      .catch((caught: unknown) => caught);

    expect(violatedConstraint(twoTargets)).toBe('artifact_links_exactly_one_target_check');
  });

  it('refuses a link to a target that does not exist', async () => {
    const { repositories, run } = await evidenceContext();

    const artifact = await repositories.artifacts.create({
      runId: run.id,
      kind: 'error_context',
      contentType: 'application/json',
      storageKey: `runs/${run.id}/error.json`,
      sizeBytes: 64,
      sha256: DOM_SHA,
    });

    const error = await repositories.artifacts
      .link({
        artifactId: artifact.id,
        role: 'error_context',
        targetType: 'run_step',
        targetId: 'rstep_missing' as never,
      })
      .catch((caught: unknown) => caught);

    expect(violatedConstraint(error)).toBe('artifact_links_run_step_id_run_steps_id_fk');
  });

  it('rejects the same artifact, role, and target twice', async () => {
    const { repositories, run, step } = await evidenceContext();

    const artifact = await repositories.artifacts.create({
      runId: run.id,
      runStepId: step.id,
      kind: 'browser_screenshot',
      contentType: 'image/png',
      storageKey: `runs/${run.id}/steps/click/after.png`,
      sizeBytes: 32,
      sha256: SCREENSHOT_SHA,
    });

    const link = {
      artifactId: artifact.id,
      role: 'screenshot_after_action' as const,
      targetType: 'run_step' as const,
      targetId: step.id,
    };

    await repositories.artifacts.link(link);
    const error = await repositories.artifacts.link(link).catch((caught: unknown) => caught);

    expect(violatedConstraint(error)).toBe('artifact_links_target_unique');
  });
});

describe('deletion behavior', () => {
  it('cascades a deleted run to its steps, events, artifacts, and links', async () => {
    const { db, repositories, run, step, event } = await evidenceContext();

    await repositories.artifacts.createWithLinks(
      {
        runId: run.id,
        runStepId: step.id,
        kind: 'browser_screenshot',
        contentType: 'image/png',
        storageKey: `runs/${run.id}/steps/click/after.png`,
        sizeBytes: 16,
        sha256: SCREENSHOT_SHA,
      },
      [{ role: 'screenshot_after_action', targetType: 'run_event', targetId: event.id }],
    );

    await db.delete(runs).where(eq(runs.id, run.id));

    expect(await db.select().from(runSteps).where(eq(runSteps.runId, run.id))).toHaveLength(0);
    expect(await db.select().from(runEvents).where(eq(runEvents.runId, run.id))).toHaveLength(0);
    expect(await db.select().from(artifacts).where(eq(artifacts.runId, run.id))).toHaveLength(0);
    expect(await db.select().from(artifactLinks)).toHaveLength(0);
  });

  it('refuses to delete an agent version that runs still reference', async () => {
    const { db, agentVersion } = await evidenceContext();

    const error = await db
      .execute(sql`delete from agent_versions where id = ${agentVersion.id}`)
      .catch((caught: unknown) => caught);

    // Evidence must not become deletable by removing the definition it used.
    // Runs and run events both restrict; whichever fires first, the delete fails.
    expect([
      'runs_agent_version_id_agent_versions_id_fk',
      'run_events_agent_version_id_agent_versions_id_fk',
    ]).toContain(violatedConstraint(error));
  });

  it('refuses to delete an agent that still has versions', async () => {
    const { db, agentVersion } = await evidenceContext();

    const error = await db
      .execute(sql`delete from agents where id = ${agentVersion.agentId}`)
      .catch((caught: unknown) => caught);

    expect(violatedConstraint(error)).toBe('agent_versions_agent_id_agents_id_fk');
  });
});
