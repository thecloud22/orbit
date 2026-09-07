import type { Executor, OrbitDatabase } from '../client';
import {
  createAgentIrCandidateRepository,
  type AgentIrCandidateRepository,
} from './agent-ir-candidates';
import { createAgentRepository, type AgentRepository } from './agents';
import { createAgentVersionRepository, type AgentVersionRepository } from './agent-versions';
import { createArtifactRepository, type ArtifactRepository } from './artifacts';
import {
  createExecutionBindingRepository,
  type ExecutionBindingRepository,
} from './execution-bindings';
import { createRunEventRepository, type RunEventRepository } from './run-events';
import { createRunStepRepository, type RunStepRepository } from './run-steps';
import { createRunRepository, type RunRepository } from './runs';
import { createSopDocumentRepository, type SopDocumentRepository } from './sop-documents';
import {
  createSopGraphRevisionRepository,
  type SopGraphRevisionRepository,
} from './sop-graph-revisions';

export * from './agent-ir-candidates';
export * from './agent-versions';
export * from './agents';
export * from './artifacts';
export * from './execution-bindings';
export * from './run-events';
export * from './run-steps';
export * from './runs';
export * from './sop-documents';
export * from './sop-graph-revisions';

export interface OrbitRepositories {
  readonly agents: AgentRepository;
  readonly agentVersions: AgentVersionRepository;
  readonly runs: RunRepository;
  readonly runSteps: RunStepRepository;
  readonly runEvents: RunEventRepository;
  readonly artifacts: ArtifactRepository;
  readonly sopDocuments: SopDocumentRepository;
  readonly sopGraphRevisions: SopGraphRevisionRepository;
  readonly executionBindings: ExecutionBindingRepository;
  readonly agentIrCandidates: AgentIrCandidateRepository;
}

export function createRepositories(executor: Executor): OrbitRepositories {
  return {
    agents: createAgentRepository(executor),
    agentVersions: createAgentVersionRepository(executor),
    runs: createRunRepository(executor),
    runSteps: createRunStepRepository(executor),
    runEvents: createRunEventRepository(executor),
    artifacts: createArtifactRepository(executor),
    sopDocuments: createSopDocumentRepository(executor),
    sopGraphRevisions: createSopGraphRevisionRepository(executor),
    executionBindings: createExecutionBindingRepository(executor),
    agentIrCandidates: createAgentIrCandidateRepository(executor),
  };
}

/**
 * Runs a unit of work in one transaction.
 *
 * Multi-entity units of work are composed here by the caller rather than hidden
 * inside a repository method: the runtime owns workflow semantics, and the
 * persistence layer owns atomicity of a single write. Creating a run and
 * appending its `run.queued` event is one such unit — either both land or
 * neither does.
 */
export async function withTransaction<T>(
  db: OrbitDatabase,
  work: (repositories: OrbitRepositories) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => work(createRepositories(tx)));
}
