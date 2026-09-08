import {
  buildStepGraph,
  successorsOf,
  type AgentIr,
  type AgentIrStep,
  type Assertion,
  type Locator,
} from '@orbit/agent-ir';
import {
  runOutputsSchema,
  type AgentVersionId,
  type BusinessOutcome,
  type OrbitError,
  type RunId,
  type RunInputs,
  type RunOutputs,
  type RunStepId,
  type RunTrigger,
  type TerminalBusinessOutcome,
} from '@orbit/contracts';

import { resolveDecision, DEFAULT_DECISION_SETTINGS, type DecisionSettings } from './decision';
import { RuntimeError, asRuntimeError, describeCause } from './errors';
import { verifyBinding, type ExecutionBindingResolver } from './drift';
import { captureEvidence, failureEvidence, successEvidence } from './evidence';
import { resolveValue, type ResolutionScope } from './interpolate';
import { silentLogger, type RuntimeLogger } from './logger';
import type {
  BrowserExecutor,
  BrowserExecutorFactory,
  DecisionJudge,
  RecordedArtifact,
  RecoveryProposer,
  RunRecorder,
  RunStore,
} from './ports';
import { assertExecutableProfile, assertNavigable, timeoutFor } from './profile';
import type { RecoveryContext } from './recovery';

/**
 * The Agent IR interpreter.
 *
 * It owns workflow order, run and step state transitions, and the event
 * timeline. It talks to a browser only through `BrowserExecutor` and to
 * PostgreSQL only through `RunRecorder`, so Playwright never decides what
 * happens next and the whole loop is exercisable without either.
 *
 * Persistence is incremental and append-only rather than wrapped in one
 * transaction: a run that dies halfway must leave the evidence it already
 * produced, not roll it away. The single exception is run creation, which
 * shares a transaction with its `run.queued` event.
 */

export interface ExecuteAgentVersionInput {
  readonly agentVersionId: AgentVersionId;
  readonly agentIr: AgentIr;
  /** Already validated against the Agent Version's declarations. */
  readonly inputs: RunInputs;
  readonly trigger: RunTrigger;
  readonly store: RunStore;
  readonly browser: BrowserExecutorFactory;
  readonly logger?: RuntimeLogger;
  /**
   * Approved Execution Bindings, when the agent has any.
   *
   * Absent for every Phase 1 agent, in which case no drift check runs and
   * execution is byte-for-byte what it was before sub-phase 2.4.
   */
  readonly bindings?: ExecutionBindingResolver;
  /**
   * The judge, when this deployment has one wired.
   *
   * Absent is a legitimate configuration and the common one: every `0.1` agent
   * runs without it. A workflow that contains a judged decision and finds no
   * judge here halts with `DECISION_JUDGE_UNAVAILABLE` rather than skipping the
   * decision it was built around.
   */
  readonly judge?: DecisionJudge;
  readonly decisions?: DecisionSettings;
  /**
   * Bounded recovery, when this deployment has a proposer wired.
   *
   * Absent is a legitimate configuration and changes nothing about how any run
   * behaves: a drifted step fails identically with or without it. What a
   * proposer adds is a *proposal* attached to the workflow's document, which a
   * person may later accept (ADR-033). It is consulted only for an agent whose
   * Agent IR declares `permissions.recovery.allowed`.
   */
  readonly recovery?: RecoveryProposer;
}

export interface ExecutedStepSummary {
  readonly agentStepId: string;
  readonly stepType: string;
  readonly status: 'succeeded' | 'failed';
}

export interface ExecutionResult {
  readonly runId: RunId;
  readonly status: 'succeeded' | 'failed';
  readonly businessOutcome: BusinessOutcome;
  readonly outputs: RunOutputs | null;
  readonly error: OrbitError | null;
  readonly steps: readonly ExecutedStepSummary[];
  readonly artifacts: readonly RecordedArtifact[];
  /** True when the run's own terminal row could not be written; the run is left non-terminal. */
  readonly terminalPersistenceFailed: boolean;
  /** True when the trace could not be persisted after an already-failing run. */
  readonly traceMissing: boolean;
}

type Outcome =
  | {
      readonly kind: 'completed';
      readonly businessOutcome: TerminalBusinessOutcome;
      readonly outputs: RunOutputs;
    }
  | { readonly kind: 'failed'; readonly error: RuntimeError };

interface StepResult {
  /** Safe step detail persisted on the run step. Never raw page content. */
  readonly output: Record<string, unknown>;
  /**
   * Set by the two steps that choose their own successor:
   * `browser.expect_one_of` and `model.decide`. Both take the value from their
   * own alternative list, never from anything a page or a model produced.
   */
  readonly next?: string;
  readonly terminal?: Outcome;
}

function describeLocator(locator: Locator): string {
  return locator.name === undefined
    ? `${locator.strategy}=${locator.value}`
    : `${locator.strategy}=${locator.value} "${locator.name}"`;
}

export async function executeAgentVersion(
  input: ExecuteAgentVersionInput,
): Promise<ExecutionResult> {
  const logger = input.logger ?? silentLogger;
  const { agentIr } = input;

  // Defensive: the entry point checks this before a run is contemplated, but an
  // unsupported construct must never reach a browser through another caller.
  assertExecutableProfile(agentIr);

  const recorder = await input.store.createRun({
    agentVersionId: input.agentVersionId,
    trigger: input.trigger,
    inputs: input.inputs,
  });

  const artifacts: RecordedArtifact[] = [];
  const steps: ExecutedStepSummary[] = [];
  let executor: BrowserExecutor | undefined;
  let outcome: Outcome;
  let traceMissing = false;

  try {
    try {
      try {
        executor = await input.browser.open();
      } catch (error) {
        throw new RuntimeError({
          code: 'WORKER_FAILURE',
          message: 'The browser could not be started for this run.',
          cause: error,
        });
      }

      await recorder.markRunning();
      await recorder.appendEvent({
        eventType: 'run.started',
        payload: {
          agentVersionId: input.agentVersionId,
          agentId: agentIr.id,
          agentVersion: agentIr.version,
        },
      });

      outcome = await interpretSteps({
        agentIr,
        agentVersionId: input.agentVersionId,
        inputs: input.inputs,
        executor,
        recorder,
        logger,
        bindings: input.bindings,
        judge: input.judge,
        recovery: input.recovery,
        decisions: input.decisions ?? DEFAULT_DECISION_SETTINGS,
        artifacts,
        steps,
      });
    } catch (error) {
      outcome = { kind: 'failed', error: asRuntimeError(error, {}) };
    }

    // The trace is persisted before the terminal run row is written, so a run is
    // never reported as succeeded without the evidence that proves it.
    if (executor !== undefined) {
      try {
        const bytes = await executor.finishTrace();
        artifacts.push(
          await recorder.recordArtifact({ kind: 'browser_trace', role: 'browser_trace', bytes }),
        );
      } catch (error) {
        if (outcome.kind === 'completed') {
          outcome = {
            kind: 'failed',
            error: new RuntimeError({
              code: 'ARTIFACT_STORAGE_ERROR',
              message: 'The run finished but its Playwright trace could not be persisted.',
              cause: error,
            }),
          };
        } else {
          // An evidence failure never replaces the failure already being recorded.
          traceMissing = true;
          logger.warn(
            { runId: recorder.runId, cause: describeCause(error) },
            'The trace could not be persisted; the original failure is unchanged.',
          );
        }
      }
    }
  } finally {
    if (executor !== undefined) {
      try {
        await executor.close();
      } catch (error) {
        logger.warn(
          { runId: recorder.runId, cause: describeCause(error) },
          'Browser cleanup failed.',
        );
      }
    }
  }

  return persistTerminalState({ recorder, outcome, artifacts, steps, logger, traceMissing });
}

interface InterpretInput {
  readonly agentIr: AgentIr;
  readonly agentVersionId: AgentVersionId;
  readonly inputs: RunInputs;
  readonly executor: BrowserExecutor;
  readonly recorder: RunRecorder;
  readonly logger: RuntimeLogger;
  readonly artifacts: RecordedArtifact[];
  readonly steps: ExecutedStepSummary[];
  readonly bindings: ExecutionBindingResolver | undefined;
  readonly judge: DecisionJudge | undefined;
  readonly decisions: DecisionSettings;
  readonly recovery: RecoveryProposer | undefined;
}

async function interpretSteps(context: InterpretInput): Promise<Outcome> {
  const { agentIr, recorder, executor, logger, artifacts, steps } = context;
  const graph = buildStepGraph(agentIr);
  const variables: Record<string, string> = {};
  const indexById = new Map(agentIr.steps.map((step, index) => [step.id, index]));

  // Counted here rather than inferred from the event log: the per-run call
  // ceiling has to be checked *before* a call, and a count derived after the
  // fact could only ever report an overspend that already happened.
  const decisionCalls = { made: 0 };

  let currentId: string | undefined = graph.entryStepId;

  while (currentId !== undefined) {
    const step: AgentIrStep | undefined = graph.stepsById.get(currentId);

    if (step === undefined) {
      throw new RuntimeError({
        code: 'INTERNAL_ERROR',
        message: `Control flow reached step "${currentId}", which the Agent IR does not define.`,
      });
    }

    const runStepId = await recorder.startStep({ agentStepId: step.id, stepType: step.type });
    await recorder.appendEvent({
      eventType: 'step.started',
      payload: { stepType: step.type, sourceSopStepIds: [...step.sourceSopStepIds] },
      runStepId,
      agentStepId: step.id,
    });

    let result: StepResult | undefined;
    let failure: RuntimeError | undefined;

    try {
      result = await performStep({ step, runStepId, variables, decisionCalls, ...context });
    } catch (error) {
      failure = asRuntimeError(error, { agentStepId: step.id });
    }

    // Evidence is captured on both paths, which is why it sits here rather than
    // inside the success branch: a failed step is exactly when a screenshot and
    // a DOM snapshot are most worth having.
    try {
      const captured = await captureEvidence({
        executor,
        recorder,
        entries: failure === undefined ? successEvidence(step, agentIr) : failureEvidence(agentIr),
        agentStepId: step.id,
        runStepId,
        logger,
        mode: failure === undefined ? 'required' : 'best_effort',
      });
      artifacts.push(...captured);
    } catch (error) {
      failure = asRuntimeError(error, { agentStepId: step.id });
    }

    if (failure !== undefined) {
      const orbitError = failure.toOrbitError();
      await recorder.failStep(runStepId, orbitError);
      await recorder.appendEvent({
        eventType: 'step.failed',
        payload: { stepType: step.type, error: orbitError },
        runStepId,
        agentStepId: step.id,
      });
      steps.push({ agentStepId: step.id, stepType: step.type, status: 'failed' });
      return { kind: 'failed', error: failure };
    }

    const stepResult = result ?? { output: {} };
    await recorder.completeStep(runStepId, stepResult.output);
    await recorder.appendEvent({
      eventType: 'step.completed',
      payload: { stepType: step.type, ...stepResult.output },
      runStepId,
      agentStepId: step.id,
    });
    steps.push({ agentStepId: step.id, stepType: step.type, status: 'succeeded' });

    if (stepResult.terminal !== undefined) {
      return stepResult.terminal;
    }

    currentId = nextStepId(agentIr, step, indexById, stepResult.next);
  }

  // Unreachable for a validated Agent IR: the validator rejects a workflow whose
  // final step is not terminal. Checked rather than assumed.
  throw new RuntimeError({
    code: 'INTERNAL_ERROR',
    message: 'Execution ran off the end of the workflow without reaching a terminal step.',
  });
}

function nextStepId(
  agentIr: AgentIr,
  step: AgentIrStep,
  indexById: ReadonlyMap<string, number>,
  chosen: string | undefined,
): string | undefined {
  if (chosen !== undefined) {
    return chosen;
  }

  const index = indexById.get(step.id) ?? -1;
  const successors = successorsOf(step, agentIr.steps[index + 1]?.id);
  return successors[0];
}

/**
 * The recovery context for one step, or nothing.
 *
 * Two gates, and both must open. The deployment must have wired a proposer, and
 * the Agent Version must declare `permissions.recovery.allowed` — an agent that
 * has not been granted the capability produces no proposals at all, and the
 * page is not even probed on its behalf (ADR-013, ADR-033).
 */
function recoveryContextFor(context: PerformStepInput): RecoveryContext | undefined {
  if (context.recovery === undefined) {
    return undefined;
  }

  return {
    proposer: context.recovery,
    permitted: context.agentIr.permissions.recovery?.allowed === true,
    recorder: context.recorder,
    runStepId: context.runStepId,
    agentVersionId: context.agentVersionId,
    agentId: context.agentIr.id,
  };
}

interface PerformStepInput extends InterpretInput {
  readonly step: AgentIrStep;
  readonly runStepId: RunStepId;
  readonly variables: Record<string, string>;
  readonly decisionCalls: { made: number };
}

async function performStep(context: PerformStepInput): Promise<StepResult> {
  const { step, executor, recorder, agentIr, inputs, variables } = context;
  const scope: ResolutionScope = { inputs, variables };
  const timeoutMs = timeoutFor(step);
  const recovery = recoveryContextFor(context);

  switch (step.type) {
    case 'browser.navigate': {
      assertNavigable(step.url, agentIr.permissions.browser?.allowedDomains ?? [], step.id);
      const navigation = await executor.navigate({ url: step.url, timeoutMs });

      await recorder.appendEvent({
        eventType: 'browser.navigation.completed',
        payload: {
          requestedUrl: step.url,
          url: navigation.url,
          httpStatus: navigation.httpStatus,
          timeoutMs,
        },
        runStepId: context.runStepId,
        agentStepId: step.id,
      });

      for (const assertion of step.assertions ?? []) {
        await evaluateAssertion(context, assertion, scope, timeoutMs);
      }

      return { output: { url: navigation.url, httpStatus: navigation.httpStatus } };
    }

    case 'browser.fill': {
      const value = resolveValue(step.value, 'value', scope, step.id);

      // Checked before the action, never after: the point is to not type into
      // the wrong field, not to discover afterwards that we did.
      await verifyBinding({
        executor,
        bindings: context.bindings,
        locator: step.locator,
        agentStepId: step.id,
        timeoutMs,
        logger: context.logger,
        ...(recovery === undefined ? {} : { recovery }),
      });

      await executor.fill({ locator: step.locator, value, timeoutMs });

      // The resolved value is deliberately absent from the payload: the event
      // records where the value came from, and `runs.inputs` is the one place
      // the value itself is persisted. That keeps the redaction seam the
      // evidence contract requires.
      await recorder.appendEvent({
        eventType: 'browser.fill.completed',
        payload: {
          locator: describeLocator(step.locator),
          valueSource: step.value,
          valueLength: value.length,
          timeoutMs,
        },
        runStepId: context.runStepId,
        agentStepId: step.id,
      });

      return { output: { locator: describeLocator(step.locator), valueSource: step.value } };
    }

    case 'browser.click': {
      await verifyBinding({
        executor,
        bindings: context.bindings,
        locator: step.locator,
        agentStepId: step.id,
        timeoutMs,
        logger: context.logger,
        ...(recovery === undefined ? {} : { recovery }),
      });

      await executor.click({ locator: step.locator, timeoutMs });

      await recorder.appendEvent({
        eventType: 'browser.click.completed',
        payload: { locator: describeLocator(step.locator), timeoutMs },
        runStepId: context.runStepId,
        agentStepId: step.id,
      });

      return { output: { locator: describeLocator(step.locator) } };
    }

    case 'browser.expect_one_of': {
      const selected = await selectAlternative(context, timeoutMs);
      const alternative = step.alternatives[selected];

      if (alternative === undefined) {
        throw new RuntimeError({
          code: 'INTERNAL_ERROR',
          message: `Step "${step.id}" selected an alternative that does not exist.`,
          agentStepId: step.id,
        });
      }

      return {
        output: {
          selectedAlternativeIndex: selected,
          matchedLocator: describeLocator(alternative.whenVisible),
          next: alternative.next,
        },
        next: alternative.next,
      };
    }

    case 'model.decide': {
      // The call is counted before it is attempted, so a refusal partway
      // through still consumes the attempt it made.
      const resolved = await resolveDecision({
        step,
        agentIr,
        agentVersionId: context.agentVersionId,
        judge: context.judge,
        executor,
        recorder,
        runStepId: context.runStepId,
        settings: context.decisions,
        timeoutMs,
        callsSoFar: context.decisionCalls.made,
        artifacts: context.artifacts,
      });

      context.decisionCalls.made += 1;

      // `next` comes from the step's own definition. The judge returned an
      // index; it never named a destination and has no way to.
      return { output: resolved.output, next: resolved.alternative.next };
    }

    case 'browser.assert': {
      const observed = await evaluateAssertion(context, step.assertion, scope, timeoutMs);
      return {
        output: {
          assertionType: step.assertion.type,
          locator: describeLocator(step.assertion.locator),
          ...observed,
        },
      };
    }

    case 'browser.extract': {
      const fields: Record<string, string> = {};

      for (const [name, field] of Object.entries(step.fields)) {
        fields[name] = await executor.readText({ locator: field.locator, timeoutMs });
      }

      const assigned: Record<string, string> = {};
      for (const [variableName, raw] of Object.entries(step.assign)) {
        const value = resolveValue(raw, 'assign', { ...scope, result: fields }, step.id);
        assigned[variableName] = value;
        variables[variableName] = value;
      }

      await recorder.appendEvent({
        eventType: 'browser.extract.completed',
        payload: { fields, assignedVariables: Object.keys(assigned) },
        runStepId: context.runStepId,
        agentStepId: step.id,
      });

      return { output: { fields, variables: assigned } };
    }

    case 'complete': {
      const resolved: Record<string, string> = {};

      for (const [name, raw] of Object.entries(step.outputs ?? {})) {
        resolved[name] = resolveValue(raw, 'output', scope, step.id);
      }

      const outputs = runOutputsSchema.parse(resolved);

      return {
        output: { outcome: step.outcome, outputs },
        terminal: { kind: 'completed', businessOutcome: step.outcome, outputs },
      };
    }

    case 'fail': {
      // The declared code and message are the failure. The runtime does not
      // reclassify, wrap, or rewrite what the Agent Version said.
      throw new RuntimeError({ code: step.errorCode, message: step.message, agentStepId: step.id });
    }
  }
}

/**
 * Resolves which known UI state occurred.
 *
 * Waits until the first alternative becomes visible rather than waiting for all
 * of them, so the losing alternative's timeout does not become the cost of every
 * run, and then re-probes every alternative: two states visible at once is a
 * classified technical failure, not a coin toss.
 */
async function selectAlternative(context: PerformStepInput, timeoutMs: number): Promise<number> {
  const { step, executor } = context;

  if (step.type !== 'browser.expect_one_of') {
    throw new RuntimeError({
      code: 'INTERNAL_ERROR',
      message: 'selectAlternative requires an expect_one_of step.',
    });
  }

  const attempts = step.alternatives.map((alternative, index) =>
    executor.waitForVisible({ locator: alternative.whenVisible, timeoutMs }).then(
      () => index,
      () => undefined,
    ),
  );

  const first = await new Promise<number | undefined>((resolve) => {
    let pending = attempts.length;

    for (const attempt of attempts) {
      void attempt.then((index) => {
        if (index !== undefined) {
          resolve(index);
        }
        pending -= 1;
        if (pending === 0) {
          resolve(undefined);
        }
      });
    }
  });

  if (first === undefined) {
    throw new RuntimeError({
      code: 'UNEXPECTED_UI_STATE',
      message: `Step "${step.id}" saw none of its known UI states within ${timeoutMs}ms.`,
      details: step.alternatives.map((alternative, index) => ({
        field: `alternatives[${index}]`,
        message: describeLocator(alternative.whenVisible),
      })),
      agentStepId: step.id,
    });
  }

  const visible: number[] = [];
  for (const [index, alternative] of step.alternatives.entries()) {
    if (await executor.isVisible({ locator: alternative.whenVisible })) {
      visible.push(index);
    }
  }

  if (visible.length > 1) {
    throw new RuntimeError({
      code: 'UNEXPECTED_UI_STATE',
      message: `Step "${step.id}" matched ${visible.length} known UI states at once, which is ambiguous.`,
      details: visible.map((index) => ({
        field: `alternatives[${index}]`,
        message: describeLocator(step.alternatives[index]!.whenVisible),
      })),
      agentStepId: step.id,
    });
  }

  return visible[0] ?? first;
}

/** Evaluates one assertion, emitting the passed/failed event either way. */
async function evaluateAssertion(
  context: PerformStepInput,
  assertion: Assertion,
  scope: ResolutionScope,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const { step, executor, recorder, runStepId } = context;
  const locator = describeLocator(assertion.locator);

  if (assertion.type === 'locator_visible') {
    try {
      await executor.waitForVisible({ locator: assertion.locator, timeoutMs });
    } catch (error) {
      await recorder.appendEvent({
        eventType: 'assertion.failed',
        payload: { assertionType: assertion.type, locator, timeoutMs },
        runStepId,
        agentStepId: step.id,
      });

      throw new RuntimeError({
        code: 'ASSERTION_FAILED',
        message: `Step "${step.id}" expected ${locator} to be visible within ${timeoutMs}ms.`,
        details: [{ field: 'locator', message: locator }],
        agentStepId: step.id,
        cause: error,
      });
    }

    await recorder.appendEvent({
      eventType: 'assertion.passed',
      payload: { assertionType: assertion.type, locator },
      runStepId,
      agentStepId: step.id,
    });

    return { assertionPassed: true };
  }

  const expected = resolveValue(assertion.expected, 'expected', scope, step.id);
  const { matched, observed } = await executor.waitForText({
    locator: assertion.locator,
    expected,
    timeoutMs,
  });

  if (!matched) {
    await recorder.appendEvent({
      eventType: 'assertion.failed',
      payload: { assertionType: assertion.type, locator, expected, observed, timeoutMs },
      runStepId,
      agentStepId: step.id,
    });

    throw new RuntimeError({
      code: 'ASSERTION_FAILED',
      message: `Step "${step.id}" expected ${locator} to have the expected text within ${timeoutMs}ms.`,
      details: [
        { field: 'locator', message: locator },
        { field: 'expected', message: expected },
        { field: 'observed', message: observed ?? '(no text observed)' },
      ],
      agentStepId: step.id,
    });
  }

  await recorder.appendEvent({
    eventType: 'assertion.passed',
    payload: { assertionType: assertion.type, locator, expected, observed },
    runStepId,
    agentStepId: step.id,
  });

  return { assertionPassed: true, expected, observed };
}

interface PersistTerminalInput {
  readonly recorder: RunRecorder;
  readonly outcome: Outcome;
  readonly artifacts: readonly RecordedArtifact[];
  readonly steps: readonly ExecutedStepSummary[];
  readonly logger: RuntimeLogger;
  readonly traceMissing: boolean;
}

/**
 * Writes the terminal run state, then the terminal event.
 *
 * The event is appended only after the row is written, so a terminal event can
 * never claim an outcome the run does not hold. If the row itself cannot be
 * written there is exactly one fallback attempt to record a failure — never a
 * retry loop, and never a quiet success.
 */
async function persistTerminalState(input: PersistTerminalInput): Promise<ExecutionResult> {
  const { recorder, outcome, logger } = input;

  const base = {
    runId: recorder.runId,
    steps: input.steps,
    artifacts: input.artifacts,
    traceMissing: input.traceMissing,
  };

  if (outcome.kind === 'completed') {
    try {
      await recorder.completeRun({
        businessOutcome: outcome.businessOutcome,
        outputs: outcome.outputs,
      });
      await recorder.appendEvent({
        eventType: 'run.completed',
        payload: { businessOutcome: outcome.businessOutcome, outputs: outcome.outputs },
      });
    } catch (error) {
      return recordTerminalFailure(input, {
        code: 'INTERNAL_ERROR',
        message: 'The run finished but its terminal state could not be persisted.',
        cause: error,
      });
    }

    return {
      ...base,
      status: 'succeeded',
      businessOutcome: outcome.businessOutcome,
      outputs: outcome.outputs,
      error: null,
      terminalPersistenceFailed: false,
    };
  }

  const orbitError = outcome.error.toOrbitError();

  try {
    await recorder.failRun(orbitError);
    await recorder.appendEvent({ eventType: 'run.failed', payload: { error: orbitError } });
  } catch (error) {
    logger.warn(
      { runId: recorder.runId, cause: describeCause(error) },
      'The run failed and its terminal state could not be persisted; the run is left non-terminal.',
    );

    return {
      ...base,
      status: 'failed',
      businessOutcome: 'none',
      outputs: null,
      error: orbitError,
      terminalPersistenceFailed: true,
    };
  }

  return {
    ...base,
    status: 'failed',
    businessOutcome: 'none',
    outputs: null,
    error: orbitError,
    terminalPersistenceFailed: false,
  };
}

/** The single fallback when a successful run's terminal write fails. */
async function recordTerminalFailure(
  input: PersistTerminalInput,
  failure: { readonly code: 'INTERNAL_ERROR'; readonly message: string; readonly cause: unknown },
): Promise<ExecutionResult> {
  const orbitError = new RuntimeError(failure).toOrbitError();

  const base = {
    runId: input.recorder.runId,
    steps: input.steps,
    artifacts: input.artifacts,
    traceMissing: input.traceMissing,
    status: 'failed' as const,
    businessOutcome: 'none' as const,
    outputs: null,
    error: orbitError,
  };

  try {
    await input.recorder.failRun(orbitError);
    await input.recorder.appendEvent({ eventType: 'run.failed', payload: { error: orbitError } });
  } catch (error) {
    input.logger.warn(
      { runId: input.recorder.runId, cause: describeCause(error) },
      'The terminal state could not be persisted by either the primary or the fallback write; the run is left non-terminal.',
    );
    return { ...base, terminalPersistenceFailed: true };
  }

  return { ...base, terminalPersistenceFailed: false };
}
