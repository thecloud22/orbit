import type { ArtifactStorage } from '@orbit/artifacts';
import { createArtifactService, type ArtifactService } from '@orbit/artifact-service';
import type { EventId, RunId, RunStepId } from '@orbit/contracts';
import {
  createRepositories,
  withTransaction,
  type OrbitDatabase,
  type OrbitRepositories,
} from '@orbit/db';

import type {
  AppendEventInput,
  CompleteRunInput,
  CreateRunInput,
  RecordArtifactInput,
  RecordedArtifact,
  RunRecorder,
  RunStore,
} from '../ports';

/**
 * The PostgreSQL and artifact-storage implementation of the runtime's
 * persistence port.
 *
 * It is the only place the interpreter's vocabulary meets Task 4's repositories
 * and Task 5's artifact service, which is what keeps the interpreter itself
 * testable without either. Sequence allocation, transaction boundaries, and
 * append-only behaviour are the repositories' own guarantees; this adapter adds
 * exactly one thing on top of them — the ordering that makes an artifact
 * evidence rather than a file.
 */
export interface DatabaseRunStoreDependencies {
  readonly database: OrbitDatabase;
  readonly storage: ArtifactStorage;
}

export function createDatabaseRunStore(deps: DatabaseRunStoreDependencies): RunStore {
  const repositories = createRepositories(deps.database);
  const artifactService = createArtifactService({ database: deps.database, storage: deps.storage });

  return {
    async createRun(input: CreateRunInput): Promise<RunRecorder> {
      // Creating the run and recording that it was queued is one fact, so it is
      // one transaction: a run that exists with no `run.queued` event would be a
      // hole at the very start of the evidence timeline.
      const runId = await withTransaction(deps.database, async (transactional) => {
        const run = await transactional.runs.create({
          agentVersionId: input.agentVersionId,
          trigger: input.trigger,
          inputs: input.inputs,
        });

        await transactional.runEvents.append({
          runId: run.id,
          agentVersionId: input.agentVersionId,
          eventType: 'run.queued',
          payload: { trigger: input.trigger.type, inputKeys: Object.keys(input.inputs) },
        });

        return run.id;
      });

      return createRecorder({
        runId,
        agentVersionId: input.agentVersionId,
        repositories,
        artifactService,
      });
    },
  };
}

interface RecorderDependencies {
  readonly runId: RunId;
  readonly agentVersionId: CreateRunInput['agentVersionId'];
  readonly repositories: OrbitRepositories;
  readonly artifactService: ArtifactService;
}

function createRecorder(deps: RecorderDependencies): RunRecorder {
  const { runId, agentVersionId, repositories, artifactService } = deps;

  async function appendEvent(input: AppendEventInput): Promise<EventId> {
    const event = await repositories.runEvents.append({
      runId,
      agentVersionId,
      eventType: input.eventType,
      payload: input.payload,
      // Phase 1 has no retry engine, so every event belongs to attempt 1. The
      // column exists so the retry design does not need a migration.
      attempt: 1,
      ...(input.runStepId === undefined ? {} : { runStepId: input.runStepId }),
      ...(input.agentStepId === undefined ? {} : { agentStepId: input.agentStepId }),
    });

    return event.id;
  }

  return {
    runId,

    async markRunning() {
      await repositories.runs.markRunning(runId);
    },

    async completeRun(input: CompleteRunInput) {
      await repositories.runs.complete(runId, {
        businessOutcome: input.businessOutcome,
        outputs: input.outputs,
      });
    },

    async failRun(error) {
      await repositories.runs.fail(runId, { error });
    },

    async startStep(input): Promise<RunStepId> {
      const step = await repositories.runSteps.start({
        runId,
        agentStepId: input.agentStepId,
        stepType: input.stepType,
      });

      return step.id;
    },

    async completeStep(runStepId, output) {
      await repositories.runSteps.complete(runStepId, output === undefined ? {} : { output });
    },

    async failStep(runStepId, error) {
      await repositories.runSteps.fail(runStepId, { error });
    },

    appendEvent,

    /**
     * Bytes, then metadata, then the entity link, then the event, then the link
     * that makes the event reference the artifact.
     *
     * The last step is not redundant: `artifactRefs` on an event envelope is
     * derived from artifact links targeting that event, so the event has to
     * exist before the reference can, and the artifact has to exist before the
     * event can name it. Doing this in one place is why no call site can invent
     * a different order.
     */
    async recordArtifact(input: RecordArtifactInput): Promise<RecordedArtifact> {
      const { artifact } = await artifactService.record({
        runId,
        kind: input.kind,
        bytes: input.bytes,
        ...(input.runStepId === undefined ? {} : { runStepId: input.runStepId }),
        links: [
          input.runStepId === undefined
            ? { targetType: 'run', targetId: runId, role: input.role }
            : { targetType: 'run_step', targetId: input.runStepId, role: input.role },
        ],
      });

      const eventId = await appendEvent({
        eventType: 'artifact.created',
        payload: {
          artifactId: artifact.id,
          kind: artifact.kind,
          role: input.role,
          contentType: artifact.contentType,
          storageKey: artifact.storageKey,
          sizeBytes: artifact.sizeBytes,
          sha256: artifact.sha256,
        },
        ...(input.runStepId === undefined ? {} : { runStepId: input.runStepId }),
        ...(input.agentStepId === undefined ? {} : { agentStepId: input.agentStepId }),
      });

      await repositories.artifacts.link({
        artifactId: artifact.id,
        role: input.role,
        targetType: 'run_event',
        targetId: eventId,
      });

      return {
        artifactId: artifact.id,
        eventId,
        kind: artifact.kind,
        role: input.role,
        contentType: artifact.contentType,
        storageKey: artifact.storageKey,
        sizeBytes: artifact.sizeBytes,
        sha256: artifact.sha256,
      };
    },
  };
}
