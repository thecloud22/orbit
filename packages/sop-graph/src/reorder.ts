import { buildStepGraph, computeDominators } from './graph';
import { describeStep, describeStepById, describeVariable } from './describe';
import { classifyValue } from './values';
import { producedBy } from './steps';
import type { SopGraph } from './sop-graph';
import { validateSopGraph, type SopGraphIssue } from './validate';

/**
 * Step reordering, and why it is not an array operation.
 *
 * Most steps fall through to whatever sits next in the list, so moving one
 * rewrites the edges around it: it can strand a step, put a step in front of the
 * value it reads, or lift a step out from behind the decision that was supposed
 * to guard it. Every proposed move is therefore applied to a copy, fully
 * re-validated, and either accepted or explained.
 *
 * The explanation matters as much as the rejection. The person reordering steps
 * wrote the SOP in plain language and is owed an answer in the same register —
 * naming the steps and values they recognise, not step ids and issue codes.
 */

export type ReorderMove =
  | { readonly stepId: string; readonly direction: 'up' | 'down' }
  | { readonly stepId: string; readonly toIndex: number };

export type ReorderResult =
  | { readonly ok: true; readonly graph: SopGraph }
  | {
      readonly ok: false;
      readonly issues: readonly SopGraphIssue[];
      /** One sentence a reviewer can act on. */
      readonly explanation: string;
    };

export class ReorderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReorderError';
  }
}

/** Applies a move to a copy. The input graph is never mutated. */
export function applyReorder(graph: SopGraph, move: ReorderMove): SopGraph {
  const from = graph.steps.findIndex((step) => step.id === move.stepId);

  if (from === -1) {
    throw new ReorderError(`Step "${move.stepId}" is not part of this workflow.`);
  }

  const to = 'toIndex' in move ? move.toIndex : move.direction === 'up' ? from - 1 : from + 1;

  if (to < 0 || to >= graph.steps.length) {
    throw new ReorderError('That step cannot move any further in that direction.');
  }

  const steps = [...graph.steps];
  const [moved] = steps.splice(from, 1);

  if (moved === undefined) {
    throw new ReorderError(`Step "${move.stepId}" could not be moved.`);
  }

  steps.splice(to, 0, moved);

  return { ...graph, steps };
}

export function validateReorder(graph: SopGraph, move: ReorderMove): ReorderResult {
  const candidate = applyReorder(graph, move);
  const issues = validateSopGraph(candidate);

  if (issues.length === 0) {
    return { ok: true, graph: candidate };
  }

  return { ok: false, issues, explanation: explainReorderFailure(graph, candidate, move, issues) };
}

/**
 * Turns the blocking issue into the sentence the reviewer sees.
 *
 * Precedence matters more than it looks. One bad move usually breaks several
 * things at once — moving a step back past the value it reads also lifts it out
 * from behind a decision, and moving a step above the decision that branches to
 * it also creates a loop. All of those reports are true; only one of them
 * describes what the person actually did.
 *
 * So the order is most-specific-cause first: the dependency the moved step
 * itself violates, then the guard it escaped, and only then the structural
 * symptoms (a loop, a stranded step, a path that stops terminating), which are
 * consequences rather than explanations.
 */
export function explainReorderFailure(
  before: SopGraph,
  after: SopGraph,
  move: ReorderMove,
  issues: readonly SopGraphIssue[],
): string {
  const movedStep = before.steps.find((step) => step.id === move.stepId);
  const movedLabel = movedStep === undefined ? move.stepId : describeStep(movedStep);

  // 1. The moved step now reads a value produced after it.
  const availability = issues.find(
    (issue) => issue.code === 'VARIABLE_NOT_AVAILABLE_ON_ALL_PATHS' && issue.stepId === move.stepId,
  );

  if (availability !== undefined) {
    const variable = firstUnavailableVariable(after, move.stepId);

    if (variable !== undefined) {
      const producer = before.steps.find((step) => producedBy(step).includes(variable));
      const producerLabel = producer === undefined ? 'a later step' : `"${describeStep(producer)}"`;

      return (
        `Cannot move "${movedLabel}" before ${producerLabel} because the moved step uses ` +
        `${describeVariable(variable)}, which is produced later in the workflow.`
      );
    }
  }

  // 2. The moved step escaped the decision that used to guard it.
  const lostGuard = findLostDecisionGuard(before, after, move.stepId);
  if (lostGuard !== undefined) {
    return (
      `Cannot move "${movedLabel}" above "${lostGuard.label}" because "${movedLabel}" is only ` +
      `reachable on one branch of that decision. Moving it would place it on paths where that ` +
      `decision has not been made.`
    );
  }

  // 3. Structural consequences.
  const unreachable = issues.find((issue) => issue.code === 'UNREACHABLE_STEP');
  if (unreachable !== undefined) {
    return (
      `Cannot move "${movedLabel}" there because it would leave ` +
      `"${describeStepById(after, unreachable.stepId ?? '')}" unreachable.`
    );
  }

  const nonTerminating = issues.find((issue) => issue.code === 'NON_TERMINATING_PATH');
  if (nonTerminating !== undefined) {
    return (
      `Cannot move "${movedLabel}" there because it would leave a path through ` +
      `"${describeStepById(after, nonTerminating.stepId ?? '')}" that never reaches an outcome.`
    );
  }

  const fallsOffEnd = issues.find((issue) => issue.code === 'FALLS_OFF_END');
  if (fallsOffEnd !== undefined) {
    return `Cannot move "${movedLabel}" there because the workflow would no longer end on an outcome.`;
  }

  const cycle = issues.find((issue) => issue.code === 'CYCLE_NOT_SUPPORTED');
  if (cycle !== undefined) {
    return `Cannot move "${movedLabel}" there because it would make the workflow loop back on itself.`;
  }

  const first = issues[0];
  return `Cannot move "${movedLabel}" there: ${first?.message ?? 'the workflow would no longer be valid.'}`;
}

/**
 * A decision that used to guard the moved step and no longer does.
 *
 * Reachability cannot see this — after such a move the step is still perfectly
 * reachable, just reachable from places the decision never ran. Dominators can:
 * if a decision was on every path to the step and now is not, the guard is gone.
 */
function findLostDecisionGuard(
  before: SopGraph,
  after: SopGraph,
  stepId: string,
): { readonly id: string; readonly label: string } | undefined {
  const dominatorsBefore = computeDominators(buildStepGraph(before)).get(stepId);
  const dominatorsAfter = computeDominators(buildStepGraph(after)).get(stepId);

  if (dominatorsBefore === undefined || dominatorsAfter === undefined) {
    return undefined;
  }

  for (const candidate of dominatorsBefore) {
    if (candidate === stepId || dominatorsAfter.has(candidate)) {
      continue;
    }

    const step = before.steps.find((entry) => entry.id === candidate);
    if (step?.kind === 'decision') {
      return { id: step.id, label: describeStep(step) };
    }
  }

  return undefined;
}

/** The variable the moved step reads that is no longer produced beforehand. */
function firstUnavailableVariable(after: SopGraph, stepId: string): string | undefined {
  const step = after.steps.find((entry) => entry.id === stepId);

  if (step === undefined) {
    return undefined;
  }

  const referenced: string[] = [];

  if (step.kind === 'fill') {
    const classified = classifyValue(step.value);
    if (classified.kind === 'reference' && classified.reference.namespace === 'variables') {
      referenced.push(classified.reference.name);
    }
  }

  if (step.kind === 'decision') {
    referenced.push(...(step.usesVariables ?? []));
  }

  // The one that a step later in the *original* order produced is the one the
  // reviewer moved past, so it is the one worth naming.
  const movedIndex = after.steps.findIndex((entry) => entry.id === stepId);

  return (
    referenced.find((name) => {
      const producerIndex = after.steps.findIndex((entry) => producedBy(entry).includes(name));
      return producerIndex === -1 || producerIndex >= movedIndex;
    }) ?? referenced[0]
  );
}
