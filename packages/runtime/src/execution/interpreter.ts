import {
  buildStepGraph,
  classifyInterpolation,
  successorsOf,
  surfacesUsedBy,
  type AgentIr,
  type AgentIrStep,
  type ExecutionSurface,
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

import {
  resolveDecision,
  DEFAULT_DECISION_SETTINGS,
  type DecisionSettings,
} from '../steps/decision';
import { RuntimeError, asRuntimeError, describeCause } from '../errors';
import { verifyBinding, type ExecutionBindingResolver } from '../recovery/drift';
import { captureEvidence, failureEvidence, successEvidence } from './evidence';
import { resolveValue, type ResolutionScope } from '../values/interpolate';
import { silentLogger, type RuntimeLogger } from '../logger';
import { assertApiHost, buildRequestUrl, headersFrom, readJsonPointer } from '../steps/api-request';
import { operationById, type ApiCatalog } from '@orbit/api-catalog';
import {
  compareScreen,
  fingerprintOf,
  resolveAddress,
  type ScreenAddress,
  type ScreenField,
} from '@orbit/screen-mapping';
import type {
  ApiExecutor,
  BrowserExecutor,
  CredentialResolver,
  TerminalExecutor,
  ExecutorFactories,
  SurfaceExecutor,
  DecisionJudge,
  RecordedArtifact,
  RecoveryProposer,
  RunRecorder,
  RunStore,
} from '../ports';
import {
  assertExecutableProfile,
  assertNavigable,
  assertTerminalHost,
  timeoutFor,
} from './profile';
import type { RecoveryContext } from '../recovery/recovery';

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
  /**
   * The executors this deployment has wired, by surface.
   *
   * A workflow whose steps need a surface absent from here fails with
   * `WORKER_FAILURE` naming the surface, rather than running partially.
   */
  readonly executors: ExecutorFactories;
  /**
   * Resolves credential references, when this deployment configures any.
   *
   * Absent is a legitimate configuration and the common one. A workflow that
   * references a credential and finds no resolver fails the step rather than
   * typing nothing into a credential field.
   */
  readonly credentials?: CredentialResolver;
  /**
   * Imported API contracts, by catalog id.
   *
   * Held by the deployment rather than embedded in the published version: a
   * contract is a fact about a service that can be re-imported, while the
   * version's grant -- which operations, which hosts -- is what was reviewed and
   * is immutable. A step naming a catalog this deployment does not hold fails
   * rather than calling anything.
   */
  readonly catalogs?: Readonly<Record<string, ApiCatalog>>;
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
  /**
   * True when run-scoped evidence could not be persisted after an already-failing
   * run. The browser's is its Playwright trace; each surface contributes its own.
   */
  readonly runEvidenceMissing: boolean;
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

/**
 * The executors opened for one run.
 *
 * A record rather than a `Map<ExecutionSurface, SurfaceExecutor>` so each field
 * keeps its own type: asking for the browser gives back something that can
 * click, with no cast. A surface joins by adding a field, and the exhaustive
 * switch in `openExecutorsFor` then fails to compile until it is opened.
 */
interface OpenedExecutors {
  browser?: BrowserExecutor;
  terminal?: TerminalExecutor;
  api?: ApiExecutor;
}

/** Every executor actually opened, with the surface it drives, in open order. */
function openedExecutors(
  opened: OpenedExecutors,
): readonly { readonly surface: ExecutionSurface; readonly executor: SurfaceExecutor }[] {
  const all: { readonly surface: ExecutionSurface; readonly executor: SurfaceExecutor }[] = [];
  if (opened.browser !== undefined) {
    all.push({ surface: 'browser', executor: opened.browser });
  }
  if (opened.terminal !== undefined) {
    all.push({ surface: 'terminal', executor: opened.terminal });
  }
  if (opened.api !== undefined) {
    all.push({ surface: 'api', executor: opened.api });
  }
  return all;
}

/**
 * Opens one executor per surface the workflow's steps actually use.
 *
 * Driven by the steps rather than by `permissions`, so an agent that declares a
 * surface but contains no step for it opens no session on it.
 *
 * This happens before `run.started` rather than at first use, deliberately. A
 * session that cannot be opened is a failure of the run as a whole, and opening
 * eagerly keeps it recorded where it has always been recorded — against a run
 * that is still starting — rather than moving it into the middle of the step
 * loop, where it would read as a step failure.
 */
async function openExecutorsFor(
  agentIr: AgentIr,
  factories: ExecutorFactories,
  opened: OpenedExecutors,
): Promise<void> {
  for (const surface of surfacesUsedBy(agentIr.steps.map((step) => step.type))) {
    switch (surface) {
      case 'browser': {
        const factory = factories.browser;

        if (factory === undefined) {
          throw new RuntimeError({
            code: 'WORKER_FAILURE',
            message: 'This workflow has browser steps, but no browser executor is configured.',
          });
        }

        try {
          opened.browser = await factory.open();
        } catch (error) {
          throw new RuntimeError({
            code: 'WORKER_FAILURE',
            message: 'The browser could not be started for this run.',
            cause: error,
          });
        }
        break;
      }

      case 'api': {
        const factory = factories.api;

        if (factory === undefined) {
          throw new RuntimeError({
            code: 'WORKER_FAILURE',
            message: 'This workflow has API steps, but no API executor is configured.',
          });
        }

        opened.api = await factory.open();
        break;
      }

      case 'terminal': {
        const factory = factories.terminal;

        if (factory === undefined) {
          throw new RuntimeError({
            code: 'WORKER_FAILURE',
            message: 'This workflow has terminal steps, but no terminal executor is configured.',
          });
        }

        try {
          opened.terminal = await factory.open();
        } catch (error) {
          throw new RuntimeError({
            code: 'WORKER_FAILURE',
            message: 'The terminal emulator could not be started for this run.',
            cause: error,
          });
        }
        break;
      }
    }
  }
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
  const executors: OpenedExecutors = {};
  let outcome: Outcome;
  let runEvidenceMissing = false;

  try {
    try {
      await openExecutorsFor(agentIr, input.executors, executors);

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
        executors,
        recorder,
        logger,
        bindings: input.bindings,
        judge: input.judge,
        recovery: input.recovery,
        credentials: input.credentials,
        catalogs: input.catalogs,
        decisions: input.decisions ?? DEFAULT_DECISION_SETTINGS,
        artifacts,
        steps,
      });
    } catch (error) {
      outcome = { kind: 'failed', error: asRuntimeError(error, {}) };
    }

    // Run-scoped evidence is persisted before the terminal run row is written, so
    // a run is never reported as succeeded without the evidence that proves it.
    // Each surface names its own artifact kind and role; the interpreter records
    // whatever it is handed rather than knowing what a trace is (ADR-037).
    for (const { surface, executor } of openedExecutors(executors)) {
      try {
        for (const evidence of await executor.finishEvidence()) {
          artifacts.push(
            await recorder.recordArtifact({
              kind: evidence.kind,
              role: evidence.role,
              bytes: evidence.bytes,
            }),
          );
        }
      } catch (error) {
        if (outcome.kind === 'completed') {
          outcome = {
            kind: 'failed',
            error: new RuntimeError({
              code: 'ARTIFACT_STORAGE_ERROR',
              message: `The run finished but its ${surface} evidence could not be persisted.`,
              cause: error,
            }),
          };
        } else {
          // An evidence failure never replaces the failure already being recorded.
          runEvidenceMissing = true;
          logger.warn(
            { runId: recorder.runId, surface, cause: describeCause(error) },
            'Run-scoped evidence could not be persisted; the original failure is unchanged.',
          );
        }
      }
    }
  } finally {
    for (const { surface, executor } of openedExecutors(executors)) {
      try {
        await executor.close();
      } catch (error) {
        logger.warn(
          { runId: recorder.runId, surface, cause: describeCause(error) },
          'Executor cleanup failed.',
        );
      }
    }
  }

  return persistTerminalState({ recorder, outcome, artifacts, steps, logger, runEvidenceMissing });
}

interface InterpretInput {
  readonly agentIr: AgentIr;
  readonly agentVersionId: AgentVersionId;
  readonly inputs: RunInputs;
  readonly executors: OpenedExecutors;
  readonly recorder: RunRecorder;
  readonly logger: RuntimeLogger;
  readonly artifacts: RecordedArtifact[];
  readonly steps: ExecutedStepSummary[];
  readonly bindings: ExecutionBindingResolver | undefined;
  readonly judge: DecisionJudge | undefined;
  readonly decisions: DecisionSettings;
  readonly recovery: RecoveryProposer | undefined;
  readonly credentials: CredentialResolver | undefined;
  readonly catalogs: Readonly<Record<string, ApiCatalog>> | undefined;
}

async function interpretSteps(context: InterpretInput): Promise<Outcome> {
  const { agentIr, recorder, logger, artifacts, steps } = context;

  // Evidence is still browser-shaped: screenshots and DOM snapshots are the only
  // captures defined. A run that opened no browser therefore captures none, which
  // is correct rather than a gap -- the surfaces that bring their own evidence
  // sets bring the code that captures them (ADR-037).
  const browser = context.executors.browser;
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
        executor: browser,
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

/**
 * The browser executor for a step that needs one.
 *
 * A step whose surface was never opened is a wiring failure rather than a step
 * failure, and says so: the workflow declared a step the deployment cannot run.
 * Resolved per step rather than once, because a workflow whose only step is
 * `complete` touches no surface and must not require one.
 */
function browserFor(context: {
  readonly executors: OpenedExecutors;
  readonly step: AgentIrStep;
}): BrowserExecutor {
  const executor = context.executors.browser;

  if (executor === undefined) {
    throw new RuntimeError({
      code: 'WORKER_FAILURE',
      message: `Step "${context.step.id}" runs on the browser surface, which was not opened for this run.`,
      agentStepId: context.step.id,
    });
  }

  return executor;
}

/** The credential a value names, or nothing if it names something else. */
function credentialReferenceIn(raw: string): string | undefined {
  const classified = classifyInterpolation(raw);
  return classified.kind === 'reference' && classified.reference.namespace === 'credentials'
    ? classified.reference.name
    : undefined;
}

/**
 * Fetches a credential at the moment it is about to be typed.
 *
 * Never cached, never returned into the resolution scope, and never logged. The
 * value exists in the caller's local and nowhere else. Both failures are the
 * same shape deliberately -- an unconfigured name and an unwired resolver are
 * both "this deployment cannot supply this", and neither says anything about the
 * secret.
 */
async function resolveCredential(
  context: PerformStepInput,
  reference: string,
  agentStepId: string,
): Promise<string> {
  const resolved = await context.credentials?.resolve(reference);

  if (resolved === undefined || resolved === '') {
    throw new RuntimeError({
      code: 'WORKER_FAILURE',
      message: `Step "${agentStepId}" needs the credential "${reference}", which this deployment does not supply.`,
      agentStepId,
    });
  }

  return resolved;
}

/** The terminal executor for a step that needs one. */
function terminalFor(context: {
  readonly executors: OpenedExecutors;
  readonly step: AgentIrStep;
}): TerminalExecutor {
  const executor = context.executors.terminal;

  if (executor === undefined) {
    throw new RuntimeError({
      code: 'WORKER_FAILURE',
      message: `Step "${context.step.id}" runs on the terminal surface, which was not opened for this run.`,
      agentStepId: context.step.id,
    });
  }

  return executor;
}

/**
 * Resolves a screen address against the screen the host is showing.
 *
 * In the runtime rather than the executor, deliberately. Which field an address
 * names is workflow semantics, so it lives where the drift check lives: the
 * executor reports a `Screen` and never searches it (ADR-008, ADR-018).
 */
async function resolveField(
  executor: TerminalExecutor,
  address: ScreenAddress,
  agentStepId: string,
): Promise<ScreenField> {
  const resolution = resolveAddress(await executor.screen(), address);

  if (!resolution.resolved) {
    throw new RuntimeError({
      code: 'FIELD_NOT_FOUND',
      message:
        resolution.reason === 'ambiguous'
          ? `Step "${agentStepId}" names a field that matches more than one place on this screen.`
          : `Step "${agentStepId}" names a field this screen does not have.`,
      details: [{ field: 'address', message: describeAddress(address) }],
      agentStepId,
    });
  }

  return resolution.field;
}

function describeAddress(address: ScreenAddress): string {
  if (address.strategy === 'field_at') {
    return `field_at ${String(address.row)},${String(address.column)}`;
  }
  return address.strategy === 'field_after_label'
    ? `field_after_label "${address.label}"`
    : `named_field ${address.name}`;
}

async function performStep(context: PerformStepInput): Promise<StepResult> {
  const { step, recorder, agentIr, inputs, variables } = context;
  const scope: ResolutionScope = { inputs, variables };
  const timeoutMs = timeoutFor(step);
  const recovery = recoveryContextFor(context);

  switch (step.type) {
    case 'browser.navigate': {
      const executor = browserFor(context);
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
      const executor = browserFor(context);
      const credential = credentialReferenceIn(step.value);
      const value =
        credential === undefined
          ? resolveValue(step.value, 'value', scope, step.id)
          : await resolveCredential(context, credential, step.id);

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
          // A credential's length is itself information about the secret, so it
          // is withheld. For an ordinary value the length is a useful signal
          // that the right thing was typed.
          ...(credential === undefined ? { valueLength: value.length } : {}),
          timeoutMs,
        },
        runStepId: context.runStepId,
        agentStepId: step.id,
      });

      return { output: { locator: describeLocator(step.locator), valueSource: step.value } };
    }

    case 'browser.click': {
      const executor = browserFor(context);
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
      const executor = browserFor(context);
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
      const executor = browserFor(context);
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

    case 'terminal.connect': {
      const executor = terminalFor(context);
      assertTerminalHost(step.host, agentIr.permissions.terminal?.allowedHosts ?? [], step.id);
      await executor.connect({ host: step.host, timeoutMs });

      await recorder.appendEvent({
        eventType: 'terminal.connected',
        payload: { host: step.host, timeoutMs },
        runStepId: context.runStepId,
        agentStepId: step.id,
      });

      return { output: { host: step.host } };
    }

    case 'terminal.type': {
      const executor = terminalFor(context);
      const credential = credentialReferenceIn(step.value);
      const value =
        credential === undefined
          ? resolveValue(step.value, 'value', scope, step.id)
          : await resolveCredential(context, credential, step.id);

      const field = await resolveField(executor, step.address, step.id);
      await executor.typeAt({ position: field.start, value, timeoutMs });

      await recorder.appendEvent({
        eventType: 'terminal.typed',
        payload: {
          address: describeAddress(step.address),
          row: field.start.row,
          column: field.start.column,
          valueSource: step.value,
          // Withheld for a credential, and withheld again for a field the host
          // marked non-display -- the attribute says this is a secret, so its
          // length is information about one whatever the value came from.
          ...(credential === undefined && !field.attributes.nonDisplay
            ? { valueLength: value.length }
            : {}),
        },
        runStepId: context.runStepId,
        agentStepId: step.id,
      });

      return { output: { address: describeAddress(step.address) } };
    }

    case 'terminal.press': {
      const executor = terminalFor(context);
      await executor.press({ key: step.key, timeoutMs });

      await recorder.appendEvent({
        eventType: 'terminal.key.pressed',
        payload: { key: step.key, timeoutMs },
        runStepId: context.runStepId,
        agentStepId: step.id,
      });

      return { output: { key: step.key } };
    }

    case 'terminal.read': {
      const executor = terminalFor(context);
      const screen = await executor.screen();
      const fields: Record<string, string> = {};

      for (const [name, address] of Object.entries(step.fields)) {
        const resolution = resolveAddress(screen, address);

        if (!resolution.resolved) {
          throw new RuntimeError({
            code: 'FIELD_NOT_FOUND',
            message: `Step "${step.id}" reads "${name}", which this screen does not have.`,
            details: [{ field: name, message: describeAddress(address) }],
            agentStepId: step.id,
          });
        }

        fields[name] = resolution.field.text.trim();
      }

      const resultScope: ResolutionScope = { ...scope, result: fields };
      for (const [variable, reference] of Object.entries(step.assign)) {
        variables[variable] = resolveValue(reference, 'assign', resultScope, step.id);
      }

      await recorder.appendEvent({
        eventType: 'terminal.read.completed',
        payload: { fields: Object.keys(step.fields) },
        runStepId: context.runStepId,
        agentStepId: step.id,
      });

      return { output: fields };
    }

    case 'terminal.expect_screen': {
      const executor = terminalFor(context);
      const observed = fingerprintOf(await executor.screen());
      const comparison = compareScreen(step.fingerprint, observed);

      if (!comparison.matches) {
        throw new RuntimeError({
          code: 'UNEXPECTED_SCREEN',
          message: `Step "${step.id}" expected a different screen than the host is showing.`,
          details: comparison.mismatches.map((mismatch) => ({
            field: mismatch.field,
            message: `expected ${mismatch.expected}, observed ${mismatch.observed}`,
          })),
          agentStepId: step.id,
        });
      }

      return { output: { fieldCount: observed.fieldCount } };
    }

    case 'api.request': {
      const executor = context.executors.api;
      const catalog = context.catalogs?.[step.catalogId];

      if (executor === undefined) {
        throw new RuntimeError({
          code: 'WORKER_FAILURE',
          message: `Step "${step.id}" runs on the api surface, which was not opened for this run.`,
          agentStepId: step.id,
        });
      }

      if (catalog === undefined) {
        throw new RuntimeError({
          code: 'WORKER_FAILURE',
          message: `Step "${step.id}" names catalog "${step.catalogId}", which this deployment does not hold.`,
          agentStepId: step.id,
        });
      }

      const operation = operationById(catalog, step.operationId);

      if (operation === undefined) {
        // The validator proved the operation is permitted; finding it absent
        // here means the catalog changed under a published version, which is a
        // deployment fault rather than a workflow one.
        throw new RuntimeError({
          code: 'WORKER_FAILURE',
          message: `Operation "${step.operationId}" is not in catalog "${step.catalogId}".`,
          agentStepId: step.id,
        });
      }

      const resolvedArguments: Record<string, string> = {};
      for (const [name, raw] of Object.entries(step.arguments ?? {})) {
        resolvedArguments[name] = resolveValue(raw, 'value', scope, step.id);
      }

      const url = buildRequestUrl(catalog, operation, resolvedArguments, step.id);
      assertApiHost(url, agentIr.permissions.api?.allowedHosts ?? [], step.id);

      const headers = headersFrom(operation, resolvedArguments);

      if (step.auth !== undefined) {
        // Resolved here, into the object that is about to be sent, and nowhere
        // else. Never in the scope, never on the step's output, and the
        // executor redacts the header by name before it becomes evidence.
        const secret = await resolveCredential(context, step.auth.credentialRef, step.id);
        // Basic expects `user:password` base64-encoded. The credential holds the
        // pair as the service wants it and Orbit encodes it, rather than asking
        // somebody to paste base64 into a form nobody can read back to check.
        headers[step.auth.headerName ?? 'authorization'] =
          step.auth.scheme === 'bearer'
            ? `Bearer ${secret}`
            : `Basic ${Buffer.from(secret, 'utf8').toString('base64')}`;
      }

      const response = await executor.send({
        method: operation.method.toUpperCase(),
        url: url.toString(),
        headers,
        timeoutMs,
      });

      if (response.status >= 400) {
        throw new RuntimeError({
          code: 'API_REQUEST_FAILED',
          message: `Step "${step.id}" called "${step.operationId}" and the service answered ${String(response.status)}.`,
          details: [{ field: 'status', message: String(response.status) }],
          agentStepId: step.id,
        });
      }

      const assigned: Record<string, string> = {};
      for (const [variable, pointer] of Object.entries(step.assign ?? {})) {
        const found = readJsonPointer(response.body, pointer);

        if (found === undefined) {
          throw new RuntimeError({
            code: 'API_RESPONSE_UNEXPECTED',
            message: `Step "${step.id}" expected "${pointer}" in the response and it was not there.`,
            details: [{ field: variable, message: pointer }],
            agentStepId: step.id,
          });
        }

        assigned[variable] = found;
        variables[variable] = found;
      }

      await recorder.appendEvent({
        eventType: 'api.request.completed',
        payload: {
          catalogId: step.catalogId,
          operationId: step.operationId,
          method: operation.method.toUpperCase(),
          status: response.status,
          // The URL is recorded; the response body is not. The body goes to the
          // artifact store, where it passes through the evidence path once.
          url: url.toString(),
        },
        runStepId: context.runStepId,
        agentStepId: step.id,
      });

      return { output: { operationId: step.operationId, status: response.status, ...assigned } };
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
  const { step } = context;
  const executor = browserFor(context);

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
  const { step, recorder, runStepId } = context;
  const executor = browserFor(context);
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
  readonly runEvidenceMissing: boolean;
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
    runEvidenceMissing: input.runEvidenceMissing,
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
    runEvidenceMissing: input.runEvidenceMissing,
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
