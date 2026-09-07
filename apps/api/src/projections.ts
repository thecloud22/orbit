import type {
  AgentIrCandidateRecord,
  AgentVersionSummary,
  AgentVersionRecord,
  RunRecord,
  RunStepRecord,
  ExecutionBindingRecord,
  SopDocumentRecord,
  SopGraphRevisionRecord,
} from '@orbit/db';
import { stepChecksum } from '@orbit/db';
import { isBindableStepKind, validateBindingAgainstStep } from '@orbit/execution-mapping';
import {
  describeStep,
  describeStepById,
  describeVariable,
  producedBy,
  type SopGraph,
} from '@orbit/sop-graph';
import type { ArtifactLink, ArtifactMetadata, EventEnvelope } from '@orbit/contracts';

import type { BindingSessionState } from './recording/binding-session-registry';
import {
  artifactUrl,
  redactPayload,
  type BindingSessionView,
  type SavedBindingView,
  type AgentVersionView,
  type CandidateActionView,
  type PublishedAgentVersionView,
  type RunListItemView,
  type SopPublicationView,
  type ArtifactView,
  type RunDetailView,
  type RunEventView,
  type RunStepView,
  type RunSummaryView,
  type SopClarificationView,
  type SopDocumentSummaryView,
  type SopDraftView,
  type SopReviewStepView,
  type SopBindingsView,
  type SopReviewView,
  type SopStepBindingView,
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

export function toCandidateActionView(record: AgentIrCandidateRecord): CandidateActionView {
  return {
    candidateId: record.id,
    state: record.state,
    sandboxState: record.sandboxState,
    sandboxNote: record.sandboxNote,
  };
}

export function toPublishedAgentVersionView(record: AgentVersionRecord): PublishedAgentVersionView {
  return {
    agentVersionId: record.id,
    agentId: record.agentId,
    name: record.name,
    version: record.version,
    publishedFromCandidateId: record.publishedFromCandidateId,
    publishedAt: record.publishedAt?.toISOString() ?? null,
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

export function toRunListItemView(
  run: RunRecord,
  agentVersion: Pick<AgentVersionRecord, 'name' | 'version'>,
): RunListItemView {
  return {
    ...toRunSummaryView(run),
    agentName: agentVersion.name,
    agentVersion: agentVersion.version,
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

export function toSopDraftView(input: {
  readonly document: SopDocumentRecord;
  readonly revision: SopGraphRevisionRecord;
}): SopDraftView {
  const { graph } = input.revision;

  return {
    documentId: input.document.id,
    revisionId: input.revision.id,
    revisionNumber: input.revision.revisionNumber,
    state: input.revision.state,
    title: graph.title,
    description: graph.description ?? null,
    steps: graph.steps.map((step) => ({
      id: step.id,
      kind: step.kind,
      summary: describeStep(step),
    })),
    inputs: graph.inputs.map((declared) => ({
      id: declared.id,
      label: declared.label,
      type: declared.type,
      required: declared.required,
    })),
    assumptions: graph.assumptions.map((assumption) => ({
      id: assumption.id,
      statement: assumption.statement,
      rationale: assumption.rationale ?? null,
    })),
    clarificationQuestions: graph.clarificationQuestions.map((question) => ({
      id: question.id,
      question: question.question,
      aboutStepId: question.aboutStepId ?? null,
    })),
    risks: graph.risks.map((risk) => ({
      id: risk.id,
      statement: risk.statement,
      severity: risk.severity,
    })),
    provenance: {
      kind: input.revision.provenance.kind,
      provider: input.revision.provenance.provider ?? null,
      model: input.revision.provenance.model ?? null,
      promptVersion: input.revision.provenance.promptVersion ?? null,
      generatedAt: input.revision.provenance.generatedAt ?? null,
    },
    executable: false,
  };
}

/**
 * A revision projected for review.
 *
 * `summary` comes from `describeStep` and nowhere else — the brief's "no second
 * renderer" is enforced by there being exactly one call site for it, here.
 * `step` carries the stored step unchanged so the editor can round-trip it;
 * that is the whole graph document, which is public to a reviewer by
 * definition, and still contains no storage key, path, or database row.
 */
export function toSopReviewView(review: {
  readonly document: SopDocumentRecord;
  readonly revision: SopGraphRevisionRecord;
  readonly clarifications: readonly {
    readonly questionId: string;
    readonly question: string;
    readonly aboutStepId: string | null;
    readonly options: readonly string[] | null;
    readonly answer: string | null;
    readonly answeredAt: Date | null;
  }[];
  readonly unansweredQuestionIds: readonly string[];
  readonly availableActions: readonly string[];
  readonly editable: boolean;
  readonly publication: SopPublicationView;
}): SopReviewView {
  const { graph } = review.revision;
  const lastIndex = graph.steps.length - 1;

  // Deduplicated by name: two different paths can legitimately declare the
  // same outcome, and a reviewer only ever needs to map a name once.
  const declaredOutcomes = new Map<string, string>();
  for (const step of graph.steps) {
    if (step.kind === 'outcome' && !declaredOutcomes.has(step.outcome)) {
      declaredOutcomes.set(step.outcome, step.message);
    }
  }

  const steps: readonly SopReviewStepView[] = graph.steps.map((step, index) => ({
    id: step.id,
    kind: step.kind,
    summary: describeStep(step),
    position: index + 1,
    // Computed here because `validateReorder` throws rather than explaining a
    // move past either end of the list; the control is simply not offered.
    canMoveUp: review.editable && index > 0,
    canMoveDown: review.editable && index < lastIndex,
    // `describeVariable` turns `assignedTeam` into `Assigned Team`, so the
    // review view names values the way the person who wrote the SOP does.
    produces: producedBy(step).map(describeVariable),
    step: step as unknown as Record<string, unknown>,
  }));

  const clarifications: readonly SopClarificationView[] = review.clarifications.map((entry) => ({
    questionId: entry.questionId,
    question: entry.question,
    aboutStepId: entry.aboutStepId,
    aboutStepSummary:
      entry.aboutStepId === null ? null : describeStepById(graph, entry.aboutStepId),
    options: entry.options,
    answer: entry.answer,
    answeredAt: entry.answeredAt === null ? null : entry.answeredAt.toISOString(),
  }));

  return {
    documentId: review.document.id,
    documentTitle: review.document.title,
    revisionId: review.revision.id,
    revisionNumber: review.revision.revisionNumber,
    state: review.revision.state,
    parentRevisionId: review.revision.parentRevisionId,
    title: graph.title,
    description: graph.description ?? null,
    steps,
    inputs: graph.inputs.map((declared) => ({
      id: declared.id,
      label: declared.label,
      type: declared.type,
      required: declared.required,
    })),
    assumptions: graph.assumptions.map((assumption) => ({
      id: assumption.id,
      statement: assumption.statement,
      rationale: assumption.rationale ?? null,
    })),
    clarifications,
    unansweredQuestionIds: review.unansweredQuestionIds,
    risks: graph.risks.map((risk) => ({
      id: risk.id,
      statement: risk.statement,
      severity: risk.severity,
    })),
    provenance: {
      kind: review.revision.provenance.kind,
      provider: review.revision.provenance.provider ?? null,
      model: review.revision.provenance.model ?? null,
      promptVersion: review.revision.provenance.promptVersion ?? null,
      generatedAt: review.revision.provenance.generatedAt ?? null,
    },
    availableActions: review.availableActions,
    publication: review.publication,
    declaredOutcomes: [...declaredOutcomes].map(([name, message]) => ({ name, message })),
    editable: review.editable,
    reviewNote: review.revision.reviewNote,
    reviewedAt:
      review.revision.reviewedAt === null ? null : review.revision.reviewedAt.toISOString(),
    executable: false,
  };
}

export function toSopDocumentSummaryView(summary: {
  readonly id: SopDocumentRecord['id'];
  readonly title: string;
  readonly status: string | null;
  readonly revisionCount: number;
  readonly stepCount: number;
  readonly createdAt: Date;
}): SopDocumentSummaryView {
  return {
    documentId: summary.id,
    title: summary.title,
    status: summary.status,
    revisionCount: summary.revisionCount,
    stepCount: summary.stepCount,
    createdAt: summary.createdAt.toISOString(),
  };
}

/**
 * Binding status per step, projected for the review page.
 *
 * The step's *label* is deliberately absent. It already reaches the UI through
 * `SopReviewStepView.summary`, computed by the one `describeStep` call site
 * above, and the panel joins on `stepId` rather than rendering it a second time
 * — which is the whole reason that call site is the only one.
 */
export function toSopBindingsView(input: {
  readonly documentId: string;
  readonly revisionId: string;
  readonly graph: SopGraph;
  readonly current: readonly ExecutionBindingRecord[];
  readonly all: readonly ExecutionBindingRecord[];
  readonly declaredNames: readonly string[];
}): SopBindingsView {
  const currentByStep = new Map(input.current.map((binding) => [binding.stepId, binding]));

  const supersededByStep = new Map<string, number>();
  for (const binding of input.all) {
    if (binding.state === 'superseded') {
      supersededByStep.set(binding.stepId, (supersededByStep.get(binding.stepId) ?? 0) + 1);
    }
  }

  const steps: readonly SopStepBindingView[] = input.graph.steps.map((step) => {
    const bindable = isBindableStepKind(step.kind);
    const binding = currentByStep.get(step.id);

    // Reused rather than a hand-rolled hash comparison: the same validator the
    // recorder runs before persisting, so "stale" here means exactly what it
    // means there, and any other mismatch comes along for free.
    const issues =
      binding === undefined
        ? []
        : validateBindingAgainstStep(binding.binding, {
            stepId: step.id,
            kind: step.kind,
            declaredNames: input.declaredNames,
            stepSha256: stepChecksum(step),
          });

    const approved = binding !== undefined && binding.state === 'approved';

    return {
      stepId: step.id,
      kind: step.kind,
      bindable,
      status: binding?.state ?? null,
      bindingId: binding?.id ?? null,
      supersededCount: supersededByStep.get(step.id) ?? 0,
      stale: issues.some((issue) => issue.code === 'STALE_BINDING'),
      issues: issues.map((issue) => ({ code: issue.code, message: issue.message })),
      selectors: approved
        ? binding.binding.body.target.selectors.map((locator) => ({
            strategy: locator.strategy,
            value: locator.value,
            name: locator.name ?? null,
          }))
        : null,
      fingerprint: approved
        ? {
            role: binding.binding.body.target.fingerprint.role,
            accessibleName: binding.binding.body.target.fingerprint.accessibleName,
            text: binding.binding.body.target.fingerprint.text,
            width: binding.binding.body.target.fingerprint.boundingBox?.width ?? null,
            height: binding.binding.body.target.fingerprint.boundingBox?.height ?? null,
          }
        : null,
    };
  });

  const bindableSteps = steps.filter((step) => step.bindable);

  return {
    documentId: input.documentId,
    revisionId: input.revisionId,
    steps,
    summary: {
      bindable: bindableSteps.length,
      bound: bindableSteps.filter((step) => step.status !== null).length,
      approved: bindableSteps.filter((step) => step.status === 'approved').length,
      stale: bindableSteps.filter((step) => step.stale).length,
    },
  };
}

/**
 * A binding session, as the panel polling it needs it.
 *
 * A near-copy of the registry's own state, and deliberately still a projection:
 * the registry type is API-internal, and the wire shape is a contract the web
 * app compiles against. A typed value never appears in either — it exists to
 * prove the right field was hit and goes no further than the browser it was
 * typed in.
 */
export function toBindingSessionView(state: BindingSessionState): BindingSessionView {
  return {
    sessionId: state.sessionId,
    documentId: state.documentId,
    startUrl: state.startUrl,
    currentUrl: state.currentUrl,
    startedAt: state.startedAt,
    step: {
      stepId: state.step.stepId,
      kind: state.step.kind,
      summary: state.step.summary,
      mode: state.step.mode,
      declaredValue: state.step.declaredValue,
      sensitive: state.step.sensitive,
      fields: state.step.fields,
    },
    captures: state.captures.map((capture) => ({
      captureId: capture.captureId,
      kind: capture.kind,
      description: capture.description,
      sensitive: capture.sensitive,
    })),
    failures: state.failures.map((failure) => ({ reason: failure.reason, url: failure.url })),
  };
}

export function toSavedBindingView(input: {
  readonly binding: ExecutionBindingRecord;
  readonly state: BindingSessionState;
}): SavedBindingView {
  return {
    bindingId: input.binding.id,
    stepId: input.binding.stepId,
    state: input.binding.state,
    session: toBindingSessionView(input.state),
  };
}
