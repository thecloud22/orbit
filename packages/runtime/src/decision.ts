import type { AgentIr, ModelDecideAlternative, ModelDecideStep } from '@orbit/agent-ir';
import type { AgentVersionId, RunStepId } from '@orbit/contracts';

import { RuntimeError } from './errors';
import { redactForModel, truncateForModel } from './redact';
import type {
  BrowserExecutor,
  DecisionJudge,
  JudgeRequest,
  JudgeResult,
  JudgeUsage,
  RecordedArtifact,
  RunRecorder,
} from './ports';

/**
 * Judged decisions, as the runtime sees them.
 *
 * Everything here is about *not* trusting the answer. The provider is asked for
 * one of a closed list and is called with a schema that says so, but a provider
 * honouring a schema is a convenience rather than a guarantee, so the answer is
 * re-validated here against the step's own alternatives before it can move
 * control flow one step. Nothing the judge returns is ever interpreted as a
 * locator, a URL, a selector, an expression or a step id; `next` comes from the
 * step definition.
 *
 * Every refusal path halts the run with its own typed code. There is no default
 * branch, no retry into a different answer, and no falling back to the first
 * alternative — a judged decision that cannot be made is a run that stops.
 */

/**
 * The confidence a judged decision must reach when its step declares no bar.
 *
 * Conservative by choice. A per-step threshold is the author's call, but a
 * deployment default has to protect a step whose author did not think about it,
 * and the failure mode of a permissive default is a confident wrong branch that
 * nothing reports. The entry point may override it from the environment.
 */
export const DEFAULT_DECISION_CONFIDENCE_THRESHOLD = 0.8;

export interface DecisionSettings {
  /** Applies to any judged step that declares no threshold of its own. */
  readonly defaultConfidenceThreshold: number;
}

export const DEFAULT_DECISION_SETTINGS: DecisionSettings = {
  defaultConfidenceThreshold: DEFAULT_DECISION_CONFIDENCE_THRESHOLD,
};

/** The bar in force for one step: what it declares, else the deployment default. */
export function thresholdFor(
  step: { readonly confidenceThreshold?: number | undefined },
  settings: DecisionSettings,
): number {
  return step.confidenceThreshold ?? settings.defaultConfidenceThreshold;
}

function alternativesForJudge(
  alternatives: readonly ModelDecideAlternative[],
): JudgeRequest['alternatives'] {
  // `next` is stripped deliberately: the judge never learns where an answer
  // leads, so it cannot be steered by consequence, and it is given no
  // vocabulary for naming a destination even if it tried.
  return alternatives.map((alternative) => ({
    outcome: alternative.outcome,
    description: alternative.description,
    insufficientEvidence: alternative.insufficientEvidence === true,
  }));
}

export interface ResolveDecisionInput {
  readonly step: ModelDecideStep;
  readonly agentIr: AgentIr;
  readonly agentVersionId: AgentVersionId;
  readonly judge: DecisionJudge | undefined;
  readonly executor: BrowserExecutor;
  readonly recorder: RunRecorder;
  readonly runStepId: RunStepId;
  readonly settings: DecisionSettings;
  readonly timeoutMs: number;
  /** How many judged decisions this run has already made. */
  readonly callsSoFar: number;
  readonly artifacts: RecordedArtifact[];
}

export interface ResolvedDecision {
  readonly alternativeIndex: number;
  readonly alternative: ModelDecideAlternative;
  readonly output: Record<string, unknown>;
}

/**
 * Reads the declared page regions, asks the judge, and validates the answer.
 *
 * The order matters and is not an accident: the input artifact is recorded and
 * `decision.requested` is appended *before* the provider is called, so a call
 * that never returns still leaves behind what it was asked and what it was
 * shown. Evidence that only exists on the happy path is not evidence.
 */
export async function resolveDecision(input: ResolveDecisionInput): Promise<ResolvedDecision> {
  const { step, recorder, runStepId, settings } = input;
  const threshold = thresholdFor(step, settings);

  // Two pre-flight refusals, before the page is even read. Both append
  // `decision.refused` like every other refusal does: a person asking "why did
  // this run stop" should find the answer in the decision events, whether or
  // not a request was ever made. There is deliberately no `decision.requested`
  // to pair them with — nothing was asked.
  const judge = input.judge;

  if (judge === undefined) {
    // An agent that needs judgement must not run on a runtime that cannot
    // judge. Refusing is the only safe answer: the alternative is a workflow
    // that silently skips the decision it was built around.
    throw await refuse(input, {
      code: 'DECISION_JUDGE_UNAVAILABLE',
      reason: 'judge_unavailable',
      message: `Step "${step.id}" asks a model to decide, but no judge is wired into this runtime.`,
    });
  }

  const maxCalls = input.agentIr.permissions.model?.maxCallsPerRun;

  if (maxCalls !== undefined && input.callsSoFar >= maxCalls) {
    throw await refuse(input, {
      code: 'DECISION_BUDGET_EXHAUSTED',
      reason: 'call_ceiling_reached',
      message: `This run has already made ${String(input.callsSoFar)} judged decisions, which is the limit this Agent Version declares (permissions.model.maxCallsPerRun = ${String(maxCalls)}).`,
    });
  }

  // Page text becomes model input, so it is redacted and capped once, here,
  // before it is either sent or stored. Doing it in the provider would send
  // clean text to the model and write the raw text to the artifact store.
  const sources: { readonly label: string; readonly text: string }[] = [];
  const redactionsApplied = new Set<string>();

  for (const source of step.readFrom) {
    const raw = await input.executor.readText({
      locator: source.locator,
      timeoutMs: input.timeoutMs,
    });
    const redacted = redactForModel(raw);

    for (const label of redacted.removed) {
      redactionsApplied.add(label);
    }

    sources.push({ label: source.label, text: truncateForModel(redacted.text) });
  }

  const request: JudgeRequest = {
    question: step.question,
    alternatives: alternativesForJudge(step.alternatives),
    sources,
    timeoutMs: input.timeoutMs,
    context: {
      runId: recorder.runId,
      agentVersionId: input.agentVersionId,
      agentId: input.agentIr.id,
      agentStepId: step.id,
    },
  };

  input.artifacts.push(
    await recorder.recordArtifact({
      kind: 'decision_input',
      role: 'decision_input',
      bytes: new TextEncoder().encode(
        `${JSON.stringify({ question: request.question, alternatives: request.alternatives, sources: request.sources }, null, 2)}\n`,
      ),
      runStepId,
      agentStepId: step.id,
    }),
  );

  await recorder.appendEvent({
    eventType: 'decision.requested',
    payload: {
      question: step.question,
      alternatives: request.alternatives.map((one) => one.outcome),
      sourceLabels: sources.map((one) => one.label),
      // Which rules fired, never what they removed.
      ...(redactionsApplied.size === 0 ? {} : { redactionsApplied: [...redactionsApplied] }),
      confidenceThreshold: threshold,
      timeoutMs: input.timeoutMs,
    },
    runStepId,
    agentStepId: step.id,
  });

  let result: JudgeResult;

  try {
    result = await judge.judge(request);
  } catch (error) {
    // A judge that throws is a provider failure, never a licence to guess.
    throw await refuse(input, {
      code: 'DECISION_JUDGE_FAILED',
      reason: 'provider_failed',
      message: `Step "${step.id}" asked a model to decide and the judge failed.`,
      cause: error,
    });
  }

  if (!result.ok) {
    throw await refuse(input, {
      code:
        result.reason === 'budget_exhausted'
          ? 'DECISION_BUDGET_EXHAUSTED'
          : result.reason === 'out_of_set'
            ? 'DECISION_OUT_OF_SET'
            : 'DECISION_JUDGE_FAILED',
      reason: result.reason,
      message: `Step "${step.id}" could not be decided: ${result.message}`,
      ...(result.usage === undefined ? {} : { usage: result.usage }),
    });
  }

  const index = result.alternativeIndex;

  // Independent re-validation. The provider was called with an enum schema, but
  // a schema honoured is a convenience and this is the guarantee: an index that
  // is not a whole number inside the declared range never reaches control flow.
  if (!Number.isInteger(index) || index < 0 || index >= step.alternatives.length) {
    throw await refuse(input, {
      code: 'DECISION_OUT_OF_SET',
      reason: 'out_of_set',
      message: `Step "${step.id}" received an answer that is not one of its ${String(step.alternatives.length)} declared alternatives.`,
      ...(result.usage === undefined ? {} : { usage: result.usage }),
    });
  }

  const confidence = result.confidence;

  // Absent confidence fails closed. "The provider did not say" is not evidence
  // that it was sure, and treating it as such would make the threshold optional
  // in practice for any provider that stopped reporting one.
  if (confidence === undefined || confidence < threshold) {
    throw await refuse(input, {
      code: 'DECISION_LOW_CONFIDENCE',
      reason: 'low_confidence',
      message:
        confidence === undefined
          ? `Step "${step.id}" received an answer with no confidence reported, and this step requires at least ${String(threshold)}.`
          : `Step "${step.id}" received an answer at confidence ${String(confidence)}, below the ${String(threshold)} this step requires.`,
      ...(result.usage === undefined ? {} : { usage: result.usage }),
    });
  }

  const alternative = step.alternatives[index]!;

  await recorder.appendEvent({
    eventType: 'decision.resolved',
    payload: {
      question: step.question,
      chosenOutcome: alternative.outcome,
      chosenIndex: index,
      insufficientEvidence: alternative.insufficientEvidence === true,
      confidence,
      confidenceThreshold: threshold,
      // Recorded as evidence for a person, and read by nothing. The chosen
      // branch below comes from `alternative.next` — the step's own definition.
      ...(result.rationale === undefined ? {} : { rationale: result.rationale }),
      ...usagePayload(result.usage),
    },
    runStepId,
    agentStepId: step.id,
  });

  return {
    alternativeIndex: index,
    alternative,
    output: {
      chosenOutcome: alternative.outcome,
      chosenIndex: index,
      confidence,
      confidenceThreshold: threshold,
      next: alternative.next,
      ...(result.rationale === undefined ? {} : { rationale: result.rationale }),
      ...usagePayload(result.usage),
    },
  };
}

function usagePayload(usage: JudgeUsage | undefined): Record<string, unknown> {
  return usage === undefined
    ? {}
    : {
        provider: usage.provider,
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        estimatedCostMicroUsd: usage.estimatedCostMicroUsd,
        latencyMs: usage.latencyMs,
      };
}

/** Records why a decision was refused, then produces the error that halts the run. */
async function refuse(
  input: ResolveDecisionInput,
  failure: {
    readonly code:
      | 'DECISION_JUDGE_UNAVAILABLE'
      | 'DECISION_JUDGE_FAILED'
      | 'DECISION_OUT_OF_SET'
      | 'DECISION_LOW_CONFIDENCE'
      | 'DECISION_BUDGET_EXHAUSTED';
    readonly reason: string;
    readonly message: string;
    readonly usage?: JudgeUsage;
    readonly cause?: unknown;
  },
): Promise<RuntimeError> {
  await input.recorder.appendEvent({
    eventType: 'decision.refused',
    payload: {
      question: input.step.question,
      reason: failure.reason,
      code: failure.code,
      ...usagePayload(failure.usage),
    },
    runStepId: input.runStepId,
    agentStepId: input.step.id,
  });

  return new RuntimeError({
    code: failure.code,
    message: failure.message,
    details: [{ field: 'decision.reason', message: failure.reason }],
    agentStepId: input.step.id,
    ...(failure.cause === undefined ? {} : { cause: failure.cause }),
  });
}
