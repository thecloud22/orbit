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
import { isMigrationLevelCurrent, stepChecksum, type ModelUsageTotals } from '@orbit/db';
import {
  ASSUMED_TOKENS_PER_CALL,
  MODEL_BUDGET_SCOPE_LABELS,
  type ModelBudgets,
} from '@orbit/sop-generation';
import {
  bindingTargets,
  isBindableStepKind,
  validateBindingAgainstStep,
  type ExecutionBinding,
} from '@orbit/execution-mapping';
import {
  describeStep,
  describeStepById,
  describeVariable,
  producedBy,
  type SopGraph,
} from '@orbit/sop-graph';
import type { ArtifactLink, ArtifactMetadata, EventEnvelope } from '@orbit/contracts';

import type { PlatformSnapshot } from './platform';
import type { BindingSessionState } from './recording/binding-session-registry';
import type { WalkthroughSessionState } from './recording/walkthrough-session-registry';
import {
  artifactUrl,
  redactPayload,
  type BindingSessionView,
  type SavedBindingView,
  type AgentVersionView,
  type CandidateActionView,
  type ExecutionBindingReviewView,
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
  type ModelBudgetScopeView,
  type ModelUsageTotalsView,
  type ModelUsageView,
  type RecoveryProposalView,
  type PlatformView,
  type WalkthroughSessionView,
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

export function toExecutionBindingReviewView(
  record: ExecutionBindingRecord,
): ExecutionBindingReviewView {
  return {
    bindingId: record.id,
    stepId: record.stepId,
    state: record.state,
    reviewNote: record.reviewNote,
    reviewedAt: record.reviewedAt === null ? null : record.reviewedAt.toISOString(),
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
    outputs: graph.outputs.map((declared) => ({
      name: declared.name,
      label: declared.label,
      description: declared.description ?? null,
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
            ...(step.kind === 'decision'
              ? { branchConditions: step.branches.map((branch) => branch.when) }
              : {}),
          });

    const approved = binding !== undefined && binding.state === 'approved';

    // A decision names one element per branch, so "the" element is the first
    // one it demonstrates. Shown rather than hidden: the panel's purpose is to
    // let a reviewer recognise what was bound, and the first branch's element
    // is enough to do that.
    const [target] = binding === undefined ? [] : bindingTargets(binding.binding.body);

    return {
      stepId: step.id,
      kind: step.kind,
      bindable,
      status: binding?.state ?? null,
      bindingId: binding?.id ?? null,
      supersededCount: supersededByStep.get(step.id) ?? 0,
      stale: issues.some((issue) => issue.code === 'STALE_BINDING'),
      issues: issues.map((issue) => ({ code: issue.code, message: issue.message })),
      selectors:
        approved && target !== undefined
          ? target.selectors.map((locator) => ({
              strategy: locator.strategy,
              value: locator.value,
              name: locator.name ?? null,
            }))
          : null,
      fingerprint:
        approved && target !== undefined
          ? {
              role: target.fingerprint.role,
              accessibleName: target.fingerprint.accessibleName,
              text: target.fingerprint.text,
              width: target.fingerprint.boundingBox?.width ?? null,
              height: target.fingerprint.boundingBox?.height ?? null,
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
 * One recovery proposal, projected for Studio.
 *
 * "Before" is read from the binding the proposal replaces rather than from the
 * proposal's own diagnosis, so what a reviewer compares against is the live
 * mapping as it stands right now — not a copy taken when the run failed, which
 * could have been superseded since.
 */
export function toRecoveryProposalView(input: {
  readonly id: string;
  readonly stepId: string;
  readonly state: string;
  readonly proposedForBindingId: string | null;
  readonly origin: string;
  readonly observedInRunId: string | null;
  readonly proposedBinding: ExecutionBinding;
  readonly diagnosis: Record<string, unknown>;
  readonly deterministic: boolean;
  readonly createdAt: Date;
}): RecoveryProposalView {
  const [target] = bindingTargets(input.proposedBinding.body);
  const diagnosis = input.diagnosis;

  const before = readSelectorList(diagnosis['failedLocator']);
  const after =
    target === undefined
      ? []
      : target.selectors.map((locator) => ({
          strategy: locator.strategy,
          value: locator.value,
          name: locator.name ?? null,
        }));

  return {
    proposalId: input.id,
    stepId: input.stepId,
    state: input.state,
    origin: input.origin,
    replacesBindingId: input.proposedForBindingId,
    observedInRunId: input.observedInRunId,
    summary: typeof diagnosis['summary'] === 'string' ? diagnosis['summary'] : '',
    confidence: typeof diagnosis['confidence'] === 'string' ? diagnosis['confidence'] : 'unknown',
    deterministic: input.deterministic,
    before,
    after,
    approvedFingerprint:
      target === undefined
        ? null
        : {
            role: target.fingerprint.role,
            accessibleName: target.fingerprint.accessibleName,
            text: target.fingerprint.text,
            width: target.fingerprint.boundingBox?.width ?? null,
            height: target.fingerprint.boundingBox?.height ?? null,
          },
    proposedAt: input.createdAt.toISOString(),
  };
}

/**
 * The locator that stopped working, as the diagnosis recorded it.
 *
 * Stored as the human-readable `describeSelector` string rather than a
 * structured locator, so it is parsed back into the one field the view needs
 * and never re-interpreted as something to act on.
 */
function readSelectorList(
  value: unknown,
): readonly { strategy: string; value: string; name: string | null }[] {
  if (typeof value !== 'string') {
    return [];
  }

  const separator = value.indexOf('=');

  return separator === -1
    ? [{ strategy: 'unknown', value, name: null }]
    : [{ strategy: value.slice(0, separator), value: value.slice(separator + 1), name: null }];
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
      branches: state.step.branches.map((branch) => ({
        when: branch.when,
        captured: branch.captured,
      })),
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

/**
 * One walkthrough session, as Watchtower reads it (ADR-035).
 *
 * A straight rename with no judgement in it, like every projection here. The
 * decisions — which step got which capture, and why one got nothing — were all
 * taken before this, in a pure function that cannot reach a browser.
 */
export function toWalkthroughSessionView(state: WalkthroughSessionState): WalkthroughSessionView {
  return {
    sessionId: state.sessionId,
    documentId: state.documentId,
    startUrl: state.startUrl,
    currentUrl: state.currentUrl,
    startedAt: state.startedAt,
    mode: state.mode,
    browserOpen: state.browserOpen,
    awaitingBinding: state.awaitingBinding,
    captures: state.captures.map((capture) => ({
      order: capture.order,
      kind: capture.kind,
      description: capture.description,
      sensitive: capture.sensitive,
    })),
    failures: state.failures.map((failure) => ({ reason: failure.reason, url: failure.url })),
    outcome:
      state.outcome === null
        ? null
        : {
            steps: state.outcome.steps.map((step) => ({
              stepId: step.stepId,
              stepKind: step.stepKind,
              summary: step.summary,
              proposalId: step.proposalId,
              state: step.state,
              demonstrated: step.demonstrated,
              refusal: step.refusal,
              message: step.message,
            })),
            proposed: state.outcome.proposed,
            unusedCaptures: state.outcome.unusedCaptures,
          },
  };
}

export function toSavedBindingView(input: {
  /** Null when a decision branch was captured and the binding is not yet complete. */
  readonly binding: ExecutionBindingRecord | null;
  readonly state: BindingSessionState;
}): SavedBindingView {
  return {
    bindingId: input.binding?.id ?? null,
    stepId: input.binding?.stepId ?? input.state.step.stepId,
    state: input.binding?.state ?? null,
    session: toBindingSessionView(input.state),
  };
}

/**
 * Model spend and budget headroom, for the drafting surface.
 *
 * The remaining figures are floored at zero. A negative "remaining" is
 * arithmetically true when a call overshot its ceiling — the check charges an
 * assumed size before the call and the real one can be larger — but "-4,000
 * tokens left" reads as a bug rather than as "you are out", and the fact that
 * matters is `exhausted`.
 */
export function toModelUsageView(input: {
  readonly budgets: ModelBudgets;
  readonly global: ModelUsageTotals;
  readonly document: ModelUsageTotals | null;
  readonly documentId: string | null;
}): ModelUsageView {
  const spentByScope: Readonly<Record<'global' | 'document', number>> = {
    global: input.global.totalTokens,
    document: input.document?.totalTokens ?? 0,
  };

  const scopes: ModelBudgetScopeView[] = (['global', 'document'] as const)
    // A per-document scope is meaningless when no document was asked about, so
    // it is omitted rather than reported as zero of a ceiling.
    .filter((scope) => scope !== 'document' || input.document !== null)
    .map((scope) => {
      const limit = input.budgets[scope] ?? null;
      const spent = spentByScope[scope];

      return {
        scope,
        label: MODEL_BUDGET_SCOPE_LABELS[scope],
        limitTokens: limit,
        spentTokens: spent,
        remainingTokens: limit === null ? null : Math.max(0, limit - spent),
        exhausted: limit !== null && limit - spent < ASSUMED_TOKENS_PER_CALL,
      };
    });

  return {
    global: toTotalsView(input.global),
    document: input.document === null ? null : toTotalsView(input.document),
    documentId: input.documentId,
    scopes,
    exhausted: scopes.some((scope) => scope.exhausted),
    costIsEstimated: true,
  };
}

function toTotalsView(totals: ModelUsageTotals): ModelUsageTotalsView {
  return {
    calls: totals.calls,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    totalTokens: totals.totalTokens,
    estimatedCostMicroUsd: totals.estimatedCostMicroUsd,
  };
}

/**
 * The deployment, field by field.
 *
 * Built explicitly rather than spread, which is the rule the rest of this
 * module follows and the reason it is worth following here in particular: the
 * snapshot's model summary has already dropped the API key, and building the
 * view by naming each field means a future field on the snapshot cannot reach
 * a response body by accident.
 */
export function toPlatformView(snapshot: PlatformSnapshot): PlatformView {
  const { migrations } = snapshot.database;
  const applied = migrations.applied;

  return {
    api: { host: snapshot.api.host, port: snapshot.api.port },
    authentication: 'none',
    artifactRoot: snapshot.artifactRoot,
    model: {
      configured: snapshot.model.configured,
      family: snapshot.model.family,
      invocation: snapshot.model.invocation,
      model: snapshot.model.model,
      reason: snapshot.model.reason,
    },
    database: {
      name: snapshot.database.databaseName,
      serverVersion: snapshot.database.serverVersion,
      migrationsCommitted: migrations.committed.length,
      migrationsApplied: applied.length,
      pending: migrations.pending,
      latestApplied: applied.length === 0 ? null : (applied[applied.length - 1] ?? null),
      unrecognised: migrations.unrecognised,
      current: isMigrationLevelCurrent(migrations),
    },
    orphanedRuns: snapshot.orphanedRuns.map((run) => ({
      runId: run.runId,
      status: run.status,
      queuedAt: run.queuedAt.toISOString(),
    })),
  };
}
