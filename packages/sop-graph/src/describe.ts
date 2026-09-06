import type { SopStep } from './steps';
import type { SopGraph } from './sop-graph';

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
