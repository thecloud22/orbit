import { isTerminalStep, type SopStep } from './steps';
import type { SopGraph } from './sop-graph';

/**
 * The SOP Graph control-flow model.
 *
 * Steps are an ordered list whose flow is mostly implicit:
 *
 *   - `outcome` and `manual_review` are terminal and have no successor;
 *   - `decision` transfers control only to its explicit branch targets, with no
 *     fall-through;
 *   - every other kind falls through to the next step in array order.
 *
 * That last rule is why reordering is not a cosmetic array operation: moving a
 * step rewrites the edges around it. `reorder.ts` exists because of this
 * sentence.
 *
 * Loops are out of scope for the first graph version, so a valid graph is
 * acyclic — which also means availability analysis is one pass in topological
 * order rather than a fixpoint.
 */
export interface StepGraph {
  readonly entryStepId: string;
  readonly stepsById: ReadonlyMap<string, SopStep>;
  /** Successor ids per step. May name a step that does not exist; the validator reports that. */
  readonly successors: ReadonlyMap<string, readonly string[]>;
  readonly predecessors: ReadonlyMap<string, readonly string[]>;
}

export function successorsOf(step: SopStep, nextInOrder: string | undefined): readonly string[] {
  if (isTerminalStep(step)) {
    return [];
  }

  if (step.kind === 'decision') {
    return step.branches.map((branch) => branch.nextStepId);
  }

  return nextInOrder === undefined ? [] : [nextInOrder];
}

export function buildStepGraph(graph: SopGraph): StepGraph {
  const steps = graph.steps;
  const stepsById = new Map<string, SopStep>();

  for (const step of steps) {
    // A duplicate id keeps its first definition; the validator reports the clash.
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
    const next = successorsOf(step, steps[index + 1]?.id);
    successors.set(step.id, next);

    for (const target of next) {
      predecessors.get(target)?.push(step.id);
    }
  });

  return { entryStepId: graph.entryStepId, stepsById, successors, predecessors };
}

export function reachableStepIds(graph: StepGraph): ReadonlySet<string> {
  const seen = new Set<string>();
  const queue: string[] = graph.stepsById.has(graph.entryStepId) ? [graph.entryStepId] : [];

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

/**
 * Dominators: the steps every path from the entry must pass through to reach a
 * given step.
 *
 * This is what makes "you moved that step out from behind its decision"
 * detectable rather than guessed at. If a step is only reachable on one branch
 * of a decision, that decision dominates it; if a proposed reorder removes the
 * decision from its dominators, the step now sits on paths where the decision
 * was never made. Reachability alone cannot see that — the step is still
 * reachable, just reachable from the wrong places.
 *
 * Standard iterative formulation: dom(entry) = {entry}, and
 * dom(n) = {n} ∪ ⋂ dom(p) over reachable predecessors, to a fixpoint. SOP
 * graphs are small, so the simple form is the right one.
 */
export function computeDominators(graph: StepGraph): ReadonlyMap<string, ReadonlySet<string>> {
  const reachable = reachableStepIds(graph);
  const dominators = new Map<string, Set<string>>();

  for (const stepId of reachable) {
    dominators.set(stepId, stepId === graph.entryStepId ? new Set([stepId]) : new Set(reachable));
  }

  let changed = true;

  while (changed) {
    changed = false;

    for (const stepId of reachable) {
      if (stepId === graph.entryStepId) {
        continue;
      }

      const incoming = (graph.predecessors.get(stepId) ?? []).filter((id) => reachable.has(id));

      let intersection: Set<string>;
      if (incoming.length === 0) {
        // Reachable with no reachable predecessor can only be the entry, which
        // is handled above; anything else here is unreachable in practice.
        intersection = new Set<string>();
      } else {
        intersection = new Set(dominators.get(incoming[0] as string) ?? []);
        for (const predecessor of incoming.slice(1)) {
          const predecessorDominators = dominators.get(predecessor) ?? new Set<string>();
          for (const candidate of [...intersection]) {
            if (!predecessorDominators.has(candidate)) {
              intersection.delete(candidate);
            }
          }
        }
      }

      intersection.add(stepId);

      const current = dominators.get(stepId) ?? new Set<string>();
      if (!sameSet(current, intersection)) {
        dominators.set(stepId, intersection);
        changed = true;
      }
    }
  }

  return dominators;
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
}
