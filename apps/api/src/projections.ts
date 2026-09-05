import type { AgentVersionSummary, AgentVersionRecord, RunRecord, RunStepRecord } from '@orbit/db';
import type { ArtifactLink, ArtifactMetadata, EventEnvelope } from '@orbit/contracts';

import {
  artifactUrl,
  redactPayload,
  type AgentVersionView,
  type ArtifactView,
  type RunDetailView,
  type RunEventView,
  type RunStepView,
  type RunSummaryView,
} from './views';

/**
 * Persisted records projected into wire views.
 *
 * Kept apart from `views.ts` so the type module the UI imports never reaches
 * @orbit/db. Every field is copied explicitly; there is no spread of a record
 * into a response anywhere in this file.
 */

export function toAgentVersionView(summary: AgentVersionSummary): AgentVersionView {
  return {
    id: summary.id,
    agentId: summary.agentId,
    name: summary.name,
    version: summary.version,
    description: summary.description,
    lifecycleStatus: summary.lifecycleStatus,
    inputSchema: summary.inputs,
  };
}

export function toRunSummaryView(run: RunRecord): RunSummaryView {
  return {
    id: run.id,
    status: run.status,
    businessOutcome: run.businessOutcome,
    agentVersionId: run.agentVersionId,
    queuedAt: run.queuedAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

export function toRunStepView(step: RunStepRecord): RunStepView {
  return {
    id: step.id,
    agentStepId: step.agentStepId,
    stepType: step.stepType,
    sequence: step.sequence,
    attempt: step.attempt,
    status: step.status,
    startedAt: step.startedAt?.toISOString() ?? null,
    finishedAt: step.finishedAt?.toISOString() ?? null,
    output: step.output,
    error: step.error,
  };
}

export function toRunEventView(event: EventEnvelope): RunEventView {
  return {
    id: event.id,
    sequence: event.sequence,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    runStepId: event.runStepId ?? null,
    agentStepId: event.agentStepId ?? null,
    payload: redactPayload(event.payload),
    artifactRefs: [...event.artifactRefs],
  };
}

export function toArtifactView(
  artifact: ArtifactMetadata,
  links: readonly ArtifactLink[],
): ArtifactView {
  return {
    id: artifact.id,
    kind: artifact.kind,
    contentType: artifact.contentType,
    sizeBytes: artifact.sizeBytes,
    sha256: artifact.sha256,
    createdAt: artifact.createdAt,
    runStepId: artifact.runStepId ?? null,
    roles: [...new Set(links.map((link) => link.role))],
    url: artifactUrl(artifact.runId, artifact.id),
  };
}

export function toRunDetailView(input: {
  readonly run: RunRecord;
  readonly agentVersion: AgentVersionRecord;
  readonly steps: readonly RunStepRecord[];
  readonly events: readonly EventEnvelope[];
  readonly artifacts: readonly {
    readonly artifact: ArtifactMetadata;
    readonly links: readonly ArtifactLink[];
  }[];
}): RunDetailView {
  return {
    ...toRunSummaryView(input.run),
    agentVersion: {
      id: input.agentVersion.id,
      name: input.agentVersion.name,
      version: input.agentVersion.version,
    },
    trigger: input.run.trigger,
    inputs: input.run.inputs,
    outputs: input.run.outputs,
    error: input.run.error,
    steps: input.steps.map(toRunStepView),
    events: input.events.map(toRunEventView),
    artifacts: input.artifacts.map(({ artifact, links }) => toArtifactView(artifact, links)),
  };
}
