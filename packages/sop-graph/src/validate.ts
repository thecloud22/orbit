import { classifyValue } from './values';
import {
  buildStepGraph,
  computeDominators,
  findCycle,
  reachableStepIds,
  topologicalOrder,
  type StepGraph,
} from './graph';
import { describeStep, describeVariable } from './describe';
import { isTerminalStep, optionallyProducedBy, producedBy, type SopStep } from './steps';
import type { SopGraph } from './sop-graph';

/**
 * Graph-level semantic validation.
 *
 * Everything the per-step schema cannot express lives here. Issues are
 * collected and returned rather than thrown, because a reviewer wants every
 * problem in a draft at once, and because Phase 2.2 will feed this untrusted
 * model output and needs the whole list to decide whether to retry.
 */

export const SOP_GRAPH_ISSUE_CODES = [
  'SCHEMA_ERROR',
  'JSON_PARSE_ERROR',

  'DUPLICATE_STEP_ID',
  'MISSING_ENTRY_STEP',
  'UNKNOWN_ENTRY_STEP',
  'UNKNOWN_BRANCH_TARGET',
  'UNREACHABLE_STEP',
  'NON_TERMINATING_PATH',
  'FALLS_OFF_END',
  'CYCLE_NOT_SUPPORTED',

  'DUPLICATE_INPUT_ID',
  'DUPLICATE_OUTPUT_ID',
  'DUPLICATE_VARIABLE',

  'MALFORMED_REFERENCE',
  'UNDECLARED_INPUT_REFERENCE',
  'UNDECLARED_VARIABLE_REFERENCE',
  'VARIABLE_NOT_AVAILABLE_ON_ALL_PATHS',

  'SECRET_LITERAL_EMBEDDED',
  'SECRET_REFERENCE_NOT_ALLOWED_HERE',
  'SENSITIVE_FILL_WITHOUT_SECRET_INPUT',

  'UNDECLARED_OUTCOME_RETURN',
  'OPTIONAL_VARIABLE_IN_OUTCOME',

  'INVALID_URL',
] as const;

export type SopGraphIssueCode = (typeof SOP_GRAPH_ISSUE_CODES)[number];

export interface SopGraphIssue {
  readonly code: SopGraphIssueCode;
  /** Plain language, naming steps the way a reviewer sees them. */
  readonly message: string;
  readonly path: readonly (string | number)[];
  readonly stepId?: string;
}

interface Context {
  readonly graph: SopGraph;
  readonly stepGraph: StepGraph;
  readonly issues: SopGraphIssue[];
}

function add(
  context: Context,
  code: SopGraphIssueCode,
  message: string,
  path: readonly (string | number)[],
  stepId?: string,
): void {
  context.issues.push(
    stepId === undefined ? { code, message, path } : { code, message, path, stepId },
  );
}

function checkIdentity(context: Context): void {
  const seenSteps = new Set<string>();

  context.graph.steps.forEach((step, index) => {
    if (seenSteps.has(step.id)) {
      add(context, 'DUPLICATE_STEP_ID', `Step id "${step.id}" is used more than once.`, [
        'steps',
        index,
        'id',
      ]);
    }
    seenSteps.add(step.id);
  });

  const seenInputs = new Set<string>();
  context.graph.inputs.forEach((input, index) => {
    if (seenInputs.has(input.id)) {
      add(context, 'DUPLICATE_INPUT_ID', `Input "${input.id}" is declared more than once.`, [
        'inputs',
        index,
        'id',
      ]);
    }
    seenInputs.add(input.id);
  });

  const seenOutputs = new Set<string>();
  context.graph.outputs.forEach((output, index) => {
    if (seenOutputs.has(output.name)) {
      add(context, 'DUPLICATE_OUTPUT_ID', `Output "${output.name}" is declared more than once.`, [
        'outputs',
        index,
        'name',
      ]);
    }
    seenOutputs.add(output.name);
  });

  // A variable produced twice has two definitions and no defined meaning at the
  // point it is read, so it is rejected rather than resolved by position.
  const producers = new Map<string, string>();
  context.graph.steps.forEach((step, index) => {
    for (const name of producedBy(step)) {
      const existing = producers.get(name);
      if (existing !== undefined) {
        add(
          context,
          'DUPLICATE_VARIABLE',
          `"${name}" is produced by more than one step ("${existing}" and "${step.id}").`,
          ['steps', index],
          step.id,
        );
      }
      producers.set(name, step.id);
    }
  });
}

function checkControlFlow(context: Context): void {
  const { graph, stepGraph } = context;

  if (graph.entryStepId.length === 0) {
    add(context, 'MISSING_ENTRY_STEP', 'The workflow does not define a starting step.', [
      'entryStepId',
    ]);
    return;
  }

  if (!stepGraph.stepsById.has(graph.entryStepId)) {
    add(
      context,
      'UNKNOWN_ENTRY_STEP',
      `The starting step "${graph.entryStepId}" does not match any step in the workflow.`,
      ['entryStepId'],
    );
    return;
  }

  graph.steps.forEach((step, index) => {
    if (step.kind !== 'decision') {
      return;
    }

    step.branches.forEach((branch, branchIndex) => {
      if (!stepGraph.stepsById.has(branch.nextStepId)) {
        add(
          context,
          'UNKNOWN_BRANCH_TARGET',
          `The "${branch.when}" branch of "${describeStep(step)}" points at "${branch.nextStepId}", which is not a step in this workflow.`,
          ['steps', index, 'branches', branchIndex, 'nextStepId'],
          step.id,
        );
      }
    });
  });

  const cycle = findCycle(stepGraph);
  if (cycle !== undefined) {
    add(
      context,
      'CYCLE_NOT_SUPPORTED',
      `The workflow loops back on itself (${cycle.join(' -> ')}). Loops are not supported yet.`,
      ['steps'],
    );
    return;
  }

  const lastStep = graph.steps[graph.steps.length - 1];
  if (lastStep !== undefined && !isTerminalStep(lastStep)) {
    add(
      context,
      'FALLS_OFF_END',
      `The workflow ends on "${describeStep(lastStep)}", which is not an outcome. Every workflow must finish with an outcome or a manual review.`,
      ['steps', graph.steps.length - 1],
      lastStep.id,
    );
  }

  const reachable = reachableStepIds(stepGraph);

  graph.steps.forEach((step, index) => {
    if (!reachable.has(step.id)) {
      add(
        context,
        'UNREACHABLE_STEP',
        `"${describeStep(step)}" can never be reached from the start of the workflow.`,
        ['steps', index],
        step.id,
      );
    }
  });

  // Every reachable step must be able to get to a terminal. Computed backwards
  // from the terminals so a whole dead-end region is reported at its steps
  // rather than only at the entry.
  const terminates = new Set<string>();
  let changed = true;

  while (changed) {
    changed = false;
    for (const stepId of reachable) {
      if (terminates.has(stepId)) {
        continue;
      }

      const step = stepGraph.stepsById.get(stepId);
      if (step === undefined) {
        continue;
      }

      if (isTerminalStep(step)) {
        terminates.add(stepId);
        changed = true;
        continue;
      }

      const successors = stepGraph.successors.get(stepId) ?? [];
      if (successors.length > 0 && successors.every((next) => terminates.has(next))) {
        terminates.add(stepId);
        changed = true;
      }
    }
  }

  graph.steps.forEach((step, index) => {
    if (reachable.has(step.id) && !terminates.has(step.id)) {
      add(
        context,
        'NON_TERMINATING_PATH',
        `"${describeStep(step)}" leads to a path that never reaches an outcome or a manual review.`,
        ['steps', index],
        step.id,
      );
    }
  });
}

/** Every position in a step that names a value, with its path. */
function referencesOf(
  step: SopStep,
  index: number,
): readonly (readonly [string, readonly (string | number)[]])[] {
  if (step.kind === 'fill') {
    return [[step.value, ['steps', index, 'value']]];
  }

  if (step.kind === 'decision') {
    return [
      ...(step.usesInputs ?? []).map(
        (name, position) =>
          [`\${inputs.${name}}`, ['steps', index, 'usesInputs', position]] as const,
      ),
      ...(step.usesVariables ?? []).map(
        (name, position) =>
          [`\${variables.${name}}`, ['steps', index, 'usesVariables', position]] as const,
      ),
    ];
  }

  return [];
}

function checkReferences(context: Context): void {
  const { graph } = context;
  const declaredInputs = new Map(graph.inputs.map((input) => [input.id, input]));
  const producedNames = new Set(graph.steps.flatMap((step) => producedBy(step)));

  graph.steps.forEach((step, index) => {
    for (const [raw, path] of referencesOf(step, index)) {
      const classified = classifyValue(raw);

      if (classified.kind === 'literal') {
        continue;
      }

      if (classified.kind === 'malformed') {
        add(
          context,
          'MALFORMED_REFERENCE',
          `"${raw}" looks like it refers to a value but is not written correctly. Use \${inputs.name} or \${variables.name}.`,
          path,
          step.id,
        );
        continue;
      }

      const { namespace, name } = classified.reference;

      if (namespace === 'inputs' && !declaredInputs.has(name)) {
        add(
          context,
          'UNDECLARED_INPUT_REFERENCE',
          `"${describeStep(step)}" uses the run input "${name}", which this workflow does not declare.`,
          path,
          step.id,
        );
        continue;
      }

      if (namespace === 'variables' && !producedNames.has(name)) {
        add(
          context,
          'UNDECLARED_VARIABLE_REFERENCE',
          `"${describeStep(step)}" uses "${describeVariable(name)}", which no step in this workflow produces.`,
          path,
          step.id,
        );
      }
    }
  });
}

/**
 * Availability analysis.
 *
 * A variable may only be read where every path that reaches the reading step
 * has already produced it, so the set flowing into a step is the intersection
 * of the sets flowing out of its predecessors. The graph is acyclic, so one
 * pass in topological order is enough.
 */
function availabilityByStep(context: Context): ReadonlyMap<string, ReadonlySet<string>> {
  const { stepGraph } = context;
  const order = topologicalOrder(stepGraph);
  const availableBefore = new Map<string, ReadonlySet<string>>();

  if (order === undefined) {
    return availableBefore;
  }

  const reachable = reachableStepIds(stepGraph);
  const availableAfter = new Map<string, ReadonlySet<string>>();

  for (const stepId of order) {
    const step = stepGraph.stepsById.get(stepId);
    if (step === undefined) {
      continue;
    }

    const incoming = (stepGraph.predecessors.get(stepId) ?? []).filter((id) => reachable.has(id));

    let before: ReadonlySet<string>;
    if (incoming.length === 0) {
      before = new Set<string>();
    } else {
      const sets = incoming.map((id) => availableAfter.get(id) ?? new Set<string>());
      const [first, ...rest] = sets;
      const intersection = new Set<string>(first ?? []);
      for (const other of rest) {
        for (const name of [...intersection]) {
          if (!other.has(name)) {
            intersection.delete(name);
          }
        }
      }
      before = intersection;
    }

    availableBefore.set(stepId, before);

    const after = new Set(before);
    for (const name of producedBy(step)) {
      after.add(name);
    }
    availableAfter.set(stepId, after);
  }

  return availableBefore;
}

function checkAvailability(context: Context): void {
  const { graph } = context;
  const availability = availabilityByStep(context);
  const producedNames = new Set(graph.steps.flatMap((step) => producedBy(step)));

  graph.steps.forEach((step, index) => {
    const available = availability.get(step.id);
    if (available === undefined) {
      return;
    }

    for (const [raw, path] of referencesOf(step, index)) {
      const classified = classifyValue(raw);

      if (
        classified.kind === 'reference' &&
        classified.reference.namespace === 'variables' &&
        producedNames.has(classified.reference.name) &&
        !available.has(classified.reference.name)
      ) {
        add(
          context,
          'VARIABLE_NOT_AVAILABLE_ON_ALL_PATHS',
          `"${describeStep(step)}" uses ${describeVariable(classified.reference.name)}, which is not produced on every path that reaches it.`,
          path,
          step.id,
        );
      }
    }
  });

  // An outcome may return a value produced only on some paths, but the graph has
  // to say so. This is the `onCallEngineer` case from the requirements: silently
  // returning a value that may not exist is not acceptable.
  const optionallyProduced = new Set(graph.steps.flatMap((step) => optionallyProducedBy(step)));

  graph.steps.forEach((step, index) => {
    if (step.kind !== 'outcome') {
      return;
    }

    const available = availability.get(step.id);
    if (available === undefined) {
      return;
    }

    (step.returns ?? []).forEach((entry, position) => {
      if (!producedNames.has(entry.name)) {
        add(
          context,
          'UNDECLARED_OUTCOME_RETURN',
          `The outcome "${step.outcome}" returns "${describeVariable(entry.name)}", which no step produces.`,
          ['steps', index, 'returns', position],
          step.id,
        );
        return;
      }

      const guaranteed = available.has(entry.name) && !optionallyProduced.has(entry.name);

      if (!guaranteed && entry.optional !== true) {
        add(
          context,
          'OPTIONAL_VARIABLE_IN_OUTCOME',
          `The outcome "${step.outcome}" returns ${describeVariable(entry.name)}, which is not available on every path that reaches it. Mark it optional if it may be missing.`,
          ['steps', index, 'returns', position],
          step.id,
        );
      }
    });
  });
}

/**
 * Secret rules, applied deterministically with no guessing about what looks
 * like a password.
 *
 * Three rules, all structural: a secret input carries no example or default (the
 * schema already makes that unrepresentable, and this re-checks it); a fill
 * marked `sensitive` must reference a declared secret input rather than hold a
 * literal; and a secret may be referenced only where a value is typed in — never
 * in a decision or an outcome payload, which would carry it somewhere it is not
 * needed.
 */
function checkSecrets(context: Context): void {
  const { graph } = context;
  const secretInputs = new Set(
    graph.inputs.filter((input) => input.type === 'secret').map((input) => input.id),
  );

  graph.steps.forEach((step, index) => {
    if (step.kind === 'fill') {
      const classified = classifyValue(step.value);

      if (step.sensitive === true) {
        if (classified.kind !== 'reference') {
          add(
            context,
            'SECRET_LITERAL_EMBEDDED',
            `"${describeStep(step)}" is marked sensitive but contains a typed-in value. A secret must reference a declared secret input instead.`,
            ['steps', index, 'value'],
            step.id,
          );
          return;
        }

        if (
          classified.reference.namespace !== 'inputs' ||
          !secretInputs.has(classified.reference.name)
        ) {
          add(
            context,
            'SENSITIVE_FILL_WITHOUT_SECRET_INPUT',
            `"${describeStep(step)}" is marked sensitive but does not use an input declared as a secret.`,
            ['steps', index, 'value'],
            step.id,
          );
        }
      }

      return;
    }

    // Anywhere other than a fill, naming a secret moves it somewhere it cannot
    // be needed for typing into a field.
    for (const [raw, path] of referencesOf(step, index)) {
      const classified = classifyValue(raw);

      if (
        classified.kind === 'reference' &&
        classified.reference.namespace === 'inputs' &&
        secretInputs.has(classified.reference.name)
      ) {
        add(
          context,
          'SECRET_REFERENCE_NOT_ALLOWED_HERE',
          `"${describeStep(step)}" refers to the secret "${classified.reference.name}". A secret may only be used to fill a field.`,
          path,
          step.id,
        );
      }
    }

    if (step.kind === 'outcome') {
      (step.returns ?? []).forEach((entry, position) => {
        if (secretInputs.has(entry.name)) {
          add(
            context,
            'SECRET_REFERENCE_NOT_ALLOWED_HERE',
            `The outcome "${step.outcome}" returns the secret "${entry.name}". A secret is never part of a result.`,
            ['steps', index, 'returns', position],
            step.id,
          );
        }
      });
    }
  });
}

/**
 * URLs are checked for shape and nothing else.
 *
 * `new URL` parses; it does not resolve, connect, or probe. A URL in a draft is
 * an untrusted reference until a later, separately reviewed mapping phase says
 * otherwise, and this task's code never contacts one.
 */
function checkUrls(context: Context): void {
  context.graph.steps.forEach((step, index) => {
    if (step.kind !== 'navigate' || step.urlHint === undefined) {
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(step.urlHint);
    } catch {
      add(
        context,
        'INVALID_URL',
        `"${describeStep(step)}" has a web address that is not written correctly: "${step.urlHint}".`,
        ['steps', index, 'urlHint'],
        step.id,
      );
      return;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      add(
        context,
        'INVALID_URL',
        `"${describeStep(step)}" uses "${parsed.protocol}", which is not a web address.`,
        ['steps', index, 'urlHint'],
        step.id,
      );
    }
  });
}

export function validateSopGraph(graph: SopGraph): readonly SopGraphIssue[] {
  const context: Context = { graph, stepGraph: buildStepGraph(graph), issues: [] };

  checkIdentity(context);
  checkControlFlow(context);
  checkReferences(context);
  checkSecrets(context);
  checkUrls(context);

  // Availability depends on a well-formed acyclic graph; running it over a
  // broken one would produce noise on top of the real problem.
  const structurallySound = !context.issues.some(
    (issue) =>
      issue.code === 'CYCLE_NOT_SUPPORTED' ||
      issue.code === 'UNKNOWN_ENTRY_STEP' ||
      issue.code === 'MISSING_ENTRY_STEP' ||
      issue.code === 'UNKNOWN_BRANCH_TARGET',
  );

  if (structurallySound) {
    checkAvailability(context);
  }

  return context.issues;
}

export { computeDominators };
