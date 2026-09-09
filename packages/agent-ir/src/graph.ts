import type { AgentIr } from './agent-ir';
import { isTerminalStep, type AgentIrStep } from './steps';

/**
 * The Agent IR control-flow model.
 *
 * Steps form an ordered list whose flow is implicit:
 *
 *   - `complete` and `fail` are terminal and have no successor;
 *   - `browser.expect_one_of`, `model.decide` and `value.compare` transfer
 *     control only to their explicit targets, with no fall-through. They differ
 *     in how the branch is chosen — by what is visible, by a model, by comparing
 *     two values the run already holds — not in the shape of the graph, which is
 *     why every analysis below (acyclicity, reachability, definite assignment)
 *     works on all three unchanged;
 *   - every other step falls through to the next step in array order.
 *
 * This is what the seeded fixture already means: the found path falls through
 * verify -> extract -> complete_found, and `complete_found` being terminal is
 * precisely what stops execution running on into `complete_not_found`.
 *
 * Loops are an explicit Phase 1 non-goal, so the graph must be acyclic. That
 * also means definite-assignment analysis is a single pass in topological
 * order rather than a fixpoint iteration.
 */
export interface StepGraph {
  readonly entryStepId: string;
  readonly stepsById: ReadonlyMap<string, AgentIrStep>;
  /** Successor IDs per step. May name a step that does not exist; the validator reports that. */
  readonly successors: ReadonlyMap<string, readonly string[]>;
  readonly predecessors: ReadonlyMap<string, readonly string[]>;
}

export function successorsOf(
  step: AgentIrStep,
  nextInOrder: string | undefined,
): readonly string[] {
  if (isTerminalStep(step)) {
    return [];
  }

  if (step.type === 'browser.expect_one_of' || step.type === 'model.decide') {
    return step.alternatives.map((alternative) => alternative.next);
  }

  if (step.type === 'value.compare') {
    return [step.whenTrue, step.whenFalse];
  }

  return nextInOrder === undefined ? [] : [nextInOrder];
}

export function buildStepGraph(agentIr: AgentIr): StepGraph {
  const steps = agentIr.steps;
  const stepsById = new Map<string, AgentIrStep>();

  for (const step of steps) {
    // A duplicate id keeps its first definition here; the validator reports the clash.
    if (!stepsById.has(step.id)) {
      stepsById.set(step.id, step);
    }
  }

  const successors = new Map<string, readonly string[]>();
  const predecessors = new Map<string, string[]>();

  for (const step of steps) {
    predecessors.set(step.id, predecessors.get(step.id) ?? []);
  }

  steps.forEach((step, index) => {
    const nextInOrder = steps[index + 1]?.id;
    const next = successorsOf(step, nextInOrder);
    successors.set(step.id, next);

    for (const target of next) {
      const existing = predecessors.get(target);
      if (existing !== undefined) {
        existing.push(step.id);
      }
    }
  });

  const entry = steps[0];

  return {
    entryStepId: entry?.id ?? '',
    stepsById,
    successors,
    predecessors,
  };
}

export function reachableStepIds(graph: StepGraph): ReadonlySet<string> {
  const seen = new Set<string>();
  const queue: string[] = graph.entryStepId === '' ? [] : [graph.entryStepId];

  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined || seen.has(current) || !graph.stepsById.has(current)) {
      continue;
    }

    seen.add(current);
    for (const next of graph.successors.get(current) ?? []) {
      queue.push(next);
    }
  }

  return seen;
}

/** Returns the steps forming a cycle, or undefined when the graph is acyclic. */
export function findCycle(graph: StepGraph): readonly string[] | undefined {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function walk(stepId: string): readonly string[] | undefined {
    if (visiting.has(stepId)) {
      const start = stack.indexOf(stepId);
      return [...stack.slice(start === -1 ? 0 : start), stepId];
    }

    if (visited.has(stepId) || !graph.stepsById.has(stepId)) {
      return undefined;
    }

    visiting.add(stepId);
    stack.push(stepId);

    for (const next of graph.successors.get(stepId) ?? []) {
      const cycle = walk(next);
      if (cycle !== undefined) {
        return cycle;
      }
    }

    stack.pop();
    visiting.delete(stepId);
    visited.add(stepId);
    return undefined;
  }

  for (const stepId of graph.stepsById.keys()) {
    const cycle = walk(stepId);
    if (cycle !== undefined) {
      return cycle;
    }
  }

  return undefined;
}

/** Topological order over reachable steps, or undefined if the graph has a cycle. */
export function topologicalOrder(graph: StepGraph): readonly string[] | undefined {
  if (findCycle(graph) !== undefined) {
    return undefined;
  }

  const reachable = reachableStepIds(graph);
  const remaining = new Map<string, number>();

  for (const stepId of reachable) {
    const incoming = (graph.predecessors.get(stepId) ?? []).filter((id) => reachable.has(id));
    remaining.set(stepId, incoming.length);
  }

  const ready = [...remaining.entries()]
    .filter(([, count]) => count === 0)
    .map(([stepId]) => stepId);
  const order: string[] = [];

  while (ready.length > 0) {
    const current = ready.shift();
    if (current === undefined) {
      break;
    }

    order.push(current);

    for (const next of graph.successors.get(current) ?? []) {
      if (!remaining.has(next)) {
        continue;
      }

      const count = (remaining.get(next) ?? 0) - 1;
      remaining.set(next, count);
      if (count === 0) {
        ready.push(next);
      }
    }
  }

  return order.length === reachable.size ? order : undefined;
}
