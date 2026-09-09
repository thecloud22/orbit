import type { Comparison, ComparisonOperator, SopStep } from './steps';
import type { SopGraph } from './sop-graph';
import { classifyValue } from './values';

/**
 * How a step is named when Orbit talks to a person about it.
 *
 * Validation messages and reorder explanations are read by the business user
 * who wrote the SOP, not by whoever implemented the graph. They must name a
 * step the way that person sees it — "Extract request details", not
 * `step_extract_request` — so every human-facing message goes through here.
 */
export function describeStep(step: SopStep): string {
  switch (step.kind) {
    case 'decision':
      return step.question;
    case 'outcome':
    case 'manual_review':
      return step.purpose ?? step.message;
    default:
      return step.purpose;
  }
}

export function describeStepById(graph: SopGraph, stepId: string): string {
  const step = graph.steps.find((candidate) => candidate.id === stepId);
  // Falling back to the id keeps a message about a dangling reference readable
  // rather than empty.
  return step === undefined ? stepId : describeStep(step);
}

/** Turns `assignedTeam` into `Assigned Team` for a sentence a reviewer reads. */
export function describeVariable(name: string): string {
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const OPERATOR_PHRASES: Readonly<Record<ComparisonOperator, string>> = {
  gt: 'is more than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  eq: 'is',
  neq: 'is not',
};

/** One side of a comparison, named the way the person who wrote the rule would. */
export function describeComparisonOperand(value: string): string {
  const classified = classifyValue(value);
  return classified.kind === 'reference'
    ? describeVariable(classified.reference.name)
    : classified.kind === 'literal'
      ? classified.value
      : value;
}

/**
 * A comparison as a sentence: "Loan To Value is more than 80".
 *
 * The reason this exists rather than the UI formatting a comparison itself is
 * that the same sentence has to appear in three places that must not drift --
 * the step list a reviewer approves from, the rule a decision was written from,
 * and the evidence explaining afterwards why a run branched the way it did. A
 * comparison that reads one way at approval and another way in evidence is
 * worse than one that reads awkwardly in both.
 */
export function describeComparison(comparison: Comparison): string {
  return [
    describeComparisonOperand(comparison.left),
    OPERATOR_PHRASES[comparison.operator],
    describeComparisonOperand(comparison.right),
  ].join(' ');
}
