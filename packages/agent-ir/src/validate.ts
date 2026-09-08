import type { AgentIr } from './agent-ir';
import {
  buildStepGraph,
  findCycle,
  reachableStepIds,
  topologicalOrder,
  type StepGraph,
} from './graph';
import { classifyInterpolation, type ReferenceNamespace } from './interpolation';
import {
  ALLOWED_URL_PROTOCOLS,
  EVIDENCE_TO_BROWSER_ACTION,
  grantsSurface,
  stepPermissionFor,
  type ExecutionSurface,
  type BrowserAction,
} from './permissions';
import { isTerminalStep, type AgentIrStep } from './steps';

export const AGENT_IR_ISSUE_CODES = [
  'YAML_PARSE_ERROR',
  'SCHEMA_ERROR',

  'DUPLICATE_STEP_ID',
  'UNKNOWN_BRANCH_TARGET',
  'CYCLE_NOT_SUPPORTED',
  'UNREACHABLE_STEP',
  'NO_TERMINAL_PATH',
  'FALLS_OFF_END',

  'SOP_STEP_NOT_DECLARED',

  'MALFORMED_REFERENCE',
  'REFERENCE_NOT_ALLOWED_HERE',
  'UNDECLARED_INPUT_REFERENCE',
  'UNDECLARED_VARIABLE_REFERENCE',
  'UNDECLARED_ASSIGN_TARGET',
  'UNKNOWN_EXTRACT_FIELD',
  'VARIABLE_NOT_ASSIGNED_ON_ALL_PATHS',

  'UNDECLARED_OUTPUT',
  'OUTPUT_TYPE_MISMATCH',

  'INVALID_URL',
  'UNSUPPORTED_URL_PROTOCOL',
  'DOMAIN_NOT_PERMITTED',
  'HOST_NOT_PERMITTED',
  'SURFACE_NOT_PERMITTED',
  'CREDENTIAL_NOT_PERMITTED',
  'ACTION_NOT_PERMITTED',
  'EVIDENCE_NOT_PERMITTED',
  'MODEL_NOT_PERMITTED',
] as const;

export type AgentIrIssueCode = (typeof AGENT_IR_ISSUE_CODES)[number];

export interface AgentIrIssue {
  readonly code: AgentIrIssueCode;
  readonly message: string;
  readonly path: readonly (string | number)[];
  readonly stepId?: string;
}

/** Which reference namespaces are legal in each position that accepts a dynamic value. */
const NAMESPACES_BY_POSITION = {
  // `credentials` is legal only here: a value that is typed into a field. Never
  // in an assertion, an output, or an assignment, because those are persisted
  // and a credential must not be.
  value: ['inputs', 'variables', 'credentials'],
  expected: ['inputs', 'variables'],
  assign: ['result'],
  output: ['inputs', 'variables'],
} as const satisfies Record<string, readonly ReferenceNamespace[]>;

type ValuePosition = keyof typeof NAMESPACES_BY_POSITION;

interface Context {
  readonly agentIr: AgentIr;
  readonly graph: StepGraph;
  readonly issues: AgentIrIssue[];
}

function add(
  context: Context,
  code: AgentIrIssueCode,
  message: string,
  path: readonly (string | number)[],
  stepId?: string,
): void {
  context.issues.push(
    stepId === undefined ? { code, message, path } : { code, message, path, stepId },
  );
}

/**
 * Validates one dynamic value: rejects malformed references, references from a
 * namespace that is not legal in this position, and references to declarations
 * that do not exist.
 */
function checkValue(
  context: Context,
  raw: string,
  position: ValuePosition,
  path: readonly (string | number)[],
  step: AgentIrStep,
): void {
  const classified = classifyInterpolation(raw);

  if (classified.kind === 'literal') {
    return;
  }

  if (classified.kind === 'malformed') {
    add(
      context,
      'MALFORMED_REFERENCE',
      `"${raw}" looks like an interpolation reference but is not one. Use exactly \${inputs.name} or \${variables.name}.`,
      path,
      step.id,
    );
    return;
  }

  const { namespace, name } = classified.reference;
  const allowed: readonly ReferenceNamespace[] = NAMESPACES_BY_POSITION[position];

  if (!allowed.includes(namespace)) {
    add(
      context,
      'REFERENCE_NOT_ALLOWED_HERE',
      `\${${namespace}.${name}} is not allowed here; this position accepts ${allowed
        .map((entry) => `\${${entry}.*}`)
        .join(' or ')}.`,
      path,
      step.id,
    );
    return;
  }

  if (
    namespace === 'credentials' &&
    !(context.agentIr.permissions.credentials?.allowedRefs ?? []).includes(name)
  ) {
    add(
      context,
      'CREDENTIAL_NOT_PERMITTED',
      `\${credentials.${name}} is not in permissions.credentials.allowedRefs.`,
      path,
      step.id,
    );
    return;
  }

  if (namespace === 'inputs' && context.agentIr.inputs[name] === undefined) {
    add(
      context,
      'UNDECLARED_INPUT_REFERENCE',
      `\${inputs.${name}} is not a declared input.`,
      path,
      step.id,
    );
    return;
  }

  if (namespace === 'variables' && context.agentIr.variables[name] === undefined) {
    add(
      context,
      'UNDECLARED_VARIABLE_REFERENCE',
      `\${variables.${name}} is not a declared variable.`,
      path,
      step.id,
    );
    return;
  }

  if (
    namespace === 'result' &&
    step.type === 'browser.extract' &&
    step.fields[name] === undefined
  ) {
    add(
      context,
      'UNKNOWN_EXTRACT_FIELD',
      `\${result.${name}} does not match any field extracted by this step.`,
      path,
      step.id,
    );
  }
}

function checkStepIdentity(context: Context): void {
  const seen = new Set<string>();

  context.agentIr.steps.forEach((step, index) => {
    if (seen.has(step.id)) {
      add(context, 'DUPLICATE_STEP_ID', `Step id "${step.id}" is used more than once.`, [
        'steps',
        index,
        'id',
      ]);
    }
    seen.add(step.id);
  });
}

function checkTraceability(context: Context): void {
  const declared = new Set(context.agentIr.source.sourceSopStepIds);

  context.agentIr.steps.forEach((step, index) => {
    step.sourceSopStepIds.forEach((sopStepId, sopIndex) => {
      if (!declared.has(sopStepId)) {
        add(
          context,
          'SOP_STEP_NOT_DECLARED',
          `SOP step "${sopStepId}" is not declared in source.sourceSopStepIds.`,
          ['steps', index, 'sourceSopStepIds', sopIndex],
          step.id,
        );
      }
    });
  });
}

function checkControlFlow(context: Context): void {
  const { agentIr, graph } = context;

  agentIr.steps.forEach((step, index) => {
    if (step.type !== 'browser.expect_one_of' && step.type !== 'model.decide') {
      return;
    }

    step.alternatives.forEach((alternative, alternativeIndex) => {
      if (!graph.stepsById.has(alternative.next)) {
        add(
          context,
          'UNKNOWN_BRANCH_TARGET',
          `Branch target "${alternative.next}" does not match any step id.`,
          ['steps', index, 'alternatives', alternativeIndex, 'next'],
          step.id,
        );
      }
    });
  });

  const cycle = findCycle(graph);
  if (cycle !== undefined) {
    add(
      context,
      'CYCLE_NOT_SUPPORTED',
      `Control flow forms a cycle (${cycle.join(' -> ')}). Loops are out of scope for Phase 1.`,
      ['steps'],
    );
    return;
  }

  const lastStep = agentIr.steps[agentIr.steps.length - 1];
  if (lastStep !== undefined && !isTerminalStep(lastStep)) {
    add(
      context,
      'FALLS_OFF_END',
      `The final step "${lastStep.id}" is not terminal, so execution would run off the end of the workflow.`,
      ['steps', agentIr.steps.length - 1],
      lastStep.id,
    );
  }

  const reachable = reachableStepIds(graph);

  agentIr.steps.forEach((step, index) => {
    if (!reachable.has(step.id)) {
      add(
        context,
        'UNREACHABLE_STEP',
        `Step "${step.id}" cannot be reached from the entry step.`,
        ['steps', index],
        step.id,
      );
    }
  });

  const hasTerminal = [...reachable].some((stepId) => {
    const step = graph.stepsById.get(stepId);
    return step !== undefined && isTerminalStep(step);
  });

  if (!hasTerminal) {
    add(context, 'NO_TERMINAL_PATH', 'No complete or fail step is reachable from the entry step.', [
      'steps',
    ]);
  }
}

function checkPermissions(context: Context): void {
  const permissions = context.agentIr.permissions;
  const browser = permissions.browser;
  const allowedDomains = browser?.allowedDomains ?? [];
  const granted = new Set<BrowserAction>(browser?.allowedActions ?? []);

  /** The actions granted on one surface. Absent section means none. */
  function grantedOn(surface: ExecutionSurface): ReadonlySet<string> {
    return new Set<string>(permissions[surface]?.allowedActions ?? []);
  }

  context.agentIr.steps.forEach((step, index) => {
    const required = stepPermissionFor(step.type);

    // Two distinct failures, kept distinct because they need different fixes.
    // The surface section being absent means this agent was never granted the
    // surface at all; the action being ungranted means it holds the surface but
    // not this capability on it.
    if (required !== undefined && !grantsSurface(context.agentIr.permissions, required.surface)) {
      add(
        context,
        'SURFACE_NOT_PERMITTED',
        `Step type "${step.type}" runs on the ${required.surface} surface, which this agent version does not declare. Add permissions.${required.surface}.`,
        ['steps', index, 'type'],
        step.id,
      );
    } else if (required !== undefined && !grantedOn(required.surface).has(required.action)) {
      add(
        context,
        'ACTION_NOT_PERMITTED',
        `Step type "${step.type}" requires the ${required.surface} action "${required.action}", which is not in permissions.${required.surface}.allowedActions.`,
        ['steps', index, 'type'],
        step.id,
      );
    }

    // A judged decision is a capability the agent version must have declared,
    // not something a browser grant implies. Checked here so a version that
    // never asked for judgement cannot contain a step that exercises it.
    if (step.type === 'model.decide' && context.agentIr.permissions.model?.allowed !== true) {
      add(
        context,
        'MODEL_NOT_PERMITTED',
        'This step asks a model to decide, which requires permissions.model.allowed to be true.',
        ['steps', index, 'type'],
        step.id,
      );
    }

    if ('evidence' in step && step.evidence !== undefined) {
      for (const [flag, action] of Object.entries(EVIDENCE_TO_BROWSER_ACTION)) {
        const enabled = step.evidence[flag as keyof typeof step.evidence] === true;
        if (enabled && !granted.has(action)) {
          add(
            context,
            'EVIDENCE_NOT_PERMITTED',
            `Evidence capture "${flag}" requires the browser action "${action}", which is not granted.`,
            ['steps', index, 'evidence', flag],
            step.id,
          );
        }
      }
    }

    if (step.type === 'terminal.connect') {
      // The same two-gate shape a navigation has: checked here at publish, and
      // again in the runtime before the socket is opened. Exact match, because a
      // neighbouring LPAR is a different system (ADR-022).
      if (!(permissions.terminal?.allowedHosts ?? []).includes(step.host)) {
        add(
          context,
          'HOST_NOT_PERMITTED',
          `Host "${step.host}" is not in permissions.terminal.allowedHosts.`,
          ['steps', index, 'host'],
          step.id,
        );
      }
      return;
    }

    if (step.type !== 'browser.navigate') {
      return;
    }

    let url: URL;
    try {
      url = new URL(step.url);
    } catch {
      add(
        context,
        'INVALID_URL',
        `"${step.url}" is not a valid absolute URL.`,
        ['steps', index, 'url'],
        step.id,
      );
      return;
    }

    if (!(ALLOWED_URL_PROTOCOLS as readonly string[]).includes(url.protocol)) {
      add(
        context,
        'UNSUPPORTED_URL_PROTOCOL',
        `Protocol "${url.protocol}" is not permitted; Phase 1 allows ${ALLOWED_URL_PROTOCOLS.join(' and ')} only.`,
        ['steps', index, 'url'],
        step.id,
      );
      return;
    }

    if (!allowedDomains.includes(url.hostname)) {
      add(
        context,
        'DOMAIN_NOT_PERMITTED',
        `Host "${url.hostname}" is not in permissions.browser.allowedDomains.`,
        ['steps', index, 'url'],
        step.id,
      );
    }
  });
}

function checkReferences(context: Context): void {
  const { agentIr } = context;

  agentIr.steps.forEach((step, index) => {
    switch (step.type) {
      case 'browser.fill':
        checkValue(context, step.value, 'value', ['steps', index, 'value'], step);
        break;

      case 'browser.assert':
        if (step.assertion.type === 'locator_has_text') {
          checkValue(
            context,
            step.assertion.expected,
            'expected',
            ['steps', index, 'assertion', 'expected'],
            step,
          );
        }
        break;

      case 'browser.extract':
        for (const [variableName, raw] of Object.entries(step.assign)) {
          if (agentIr.variables[variableName] === undefined) {
            add(
              context,
              'UNDECLARED_ASSIGN_TARGET',
              `"${variableName}" is not a declared variable.`,
              ['steps', index, 'assign', variableName],
              step.id,
            );
          }

          checkValue(context, raw, 'assign', ['steps', index, 'assign', variableName], step);
        }
        break;

      case 'complete':
        for (const [outputName, raw] of Object.entries(step.outputs ?? {})) {
          const declaredOutput = agentIr.outputs[outputName];

          if (declaredOutput === undefined) {
            add(
              context,
              'UNDECLARED_OUTPUT',
              `"${outputName}" is not a declared output.`,
              ['steps', index, 'outputs', outputName],
              step.id,
            );
          }

          checkValue(context, raw, 'output', ['steps', index, 'outputs', outputName], step);

          if (declaredOutput !== undefined) {
            const classified = classifyInterpolation(raw);
            if (classified.kind === 'reference') {
              const { namespace, name } = classified.reference;
              const source =
                namespace === 'inputs' ? agentIr.inputs[name] : agentIr.variables[name];

              if (source !== undefined && source.type !== declaredOutput.type) {
                add(
                  context,
                  'OUTPUT_TYPE_MISMATCH',
                  `Output "${outputName}" is declared as ${declaredOutput.type} but \${${namespace}.${name}} is ${source.type}.`,
                  ['steps', index, 'outputs', outputName],
                  step.id,
                );
              }
            }
          }
        }
        break;

      default:
        break;
    }
  });
}

/**
 * Definite-assignment analysis.
 *
 * A variable may only be read where it has been assigned on *every* path that
 * reaches the reading step, so the set flowing into a step is the intersection
 * of the sets flowing out of its predecessors. The graph is acyclic, so one
 * pass in topological order suffices.
 */
function checkDefiniteAssignment(context: Context): void {
  const { agentIr, graph } = context;
  const order = topologicalOrder(graph);

  if (order === undefined) {
    return; // A cycle was already reported; assignment analysis is meaningless.
  }

  const reachable = reachableStepIds(graph);
  const assignedAfter = new Map<string, ReadonlySet<string>>();
  const stepIndexById = new Map(agentIr.steps.map((step, index) => [step.id, index]));

  for (const stepId of order) {
    const step = graph.stepsById.get(stepId);
    if (step === undefined) {
      continue;
    }

    const incoming = (graph.predecessors.get(stepId) ?? []).filter((id) => reachable.has(id));

    let assignedBefore: ReadonlySet<string>;
    if (incoming.length === 0) {
      assignedBefore = new Set<string>();
    } else {
      const sets = incoming.map((id) => assignedAfter.get(id) ?? new Set<string>());
      const [first, ...rest] = sets;
      const intersection = new Set<string>(first ?? []);
      for (const other of rest) {
        for (const name of [...intersection]) {
          if (!other.has(name)) {
            intersection.delete(name);
          }
        }
      }
      assignedBefore = intersection;
    }

    const index = stepIndexById.get(stepId) ?? 0;
    for (const [raw, path] of readsOf(step, index)) {
      const classified = classifyInterpolation(raw);
      if (
        classified.kind === 'reference' &&
        classified.reference.namespace === 'variables' &&
        agentIr.variables[classified.reference.name] !== undefined &&
        !assignedBefore.has(classified.reference.name)
      ) {
        add(
          context,
          'VARIABLE_NOT_ASSIGNED_ON_ALL_PATHS',
          `\${variables.${classified.reference.name}} is read here but is not assigned on every path reaching this step.`,
          path,
          step.id,
        );
      }
    }

    const assigned = new Set(assignedBefore);
    if (step.type === 'browser.extract') {
      for (const variableName of Object.keys(step.assign)) {
        assigned.add(variableName);
      }
    }
    assignedAfter.set(stepId, assigned);
  }
}

/** Every position in a step that reads a dynamic value, with its path. */
function readsOf(
  step: AgentIrStep,
  index: number,
): readonly (readonly [string, readonly (string | number)[]])[] {
  switch (step.type) {
    case 'browser.fill':
      return [[step.value, ['steps', index, 'value']]];
    case 'browser.assert':
      return step.assertion.type === 'locator_has_text'
        ? [[step.assertion.expected, ['steps', index, 'assertion', 'expected']]]
        : [];
    case 'complete':
      return Object.entries(step.outputs ?? {}).map(
        ([name, raw]) => [raw, ['steps', index, 'outputs', name]] as const,
      );
    default:
      return [];
  }
}

/**
 * Cross-field validation that the structural schema cannot express.
 *
 * Returns issues rather than throwing: callers usually want to report every
 * problem in a fixture at once, and tests assert on specific codes.
 */
export function validateAgentIrSemantics(agentIr: AgentIr): readonly AgentIrIssue[] {
  const context: Context = {
    agentIr,
    graph: buildStepGraph(agentIr),
    issues: [],
  };

  checkStepIdentity(context);
  checkTraceability(context);
  checkControlFlow(context);
  checkPermissions(context);
  checkReferences(context);
  checkDefiniteAssignment(context);

  return context.issues;
}
