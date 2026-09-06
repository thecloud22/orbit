import { z } from 'zod';

/**
 * The lifecycle of one Execution Binding.
 *
 * The *pattern* is the SOP Graph revision lifecycle's — a transition table, the
 * states permitted to reach a target, and the repository applying it with the
 * expected state in the `WHERE` clause so a concurrent writer cannot slip
 * between check and write.
 *
 * The table itself is not `SOP_REVISION_TRANSITIONS`, and the reason is worth
 * stating. That type is `Record<SopRevisionState, …>`, so reusing it would make
 * a binding's state literally *be* a SOP revision state — a type-level coupling
 * between two entities that have nothing to do with each other. It also carries
 * `needs_clarification`, which is meaningless here: a binding is never asked a
 * question, it is demonstrated. See ADR-018.
 */
export const BINDING_STATES = [
  'draft',
  'needs_review',
  'approved',
  'rejected',
  'superseded',
] as const;

export type BindingState = (typeof BINDING_STATES)[number];

export const bindingStateSchema = z.enum(BINDING_STATES);

/**
 * `draft` may go straight to `needs_review` once a human has confirmed the
 * recording. Anything may be superseded, because re-recording a step replaces
 * whatever came before it regardless of how far that one got. `superseded` is
 * terminal — a replaced binding is a historical record and never re-enters the
 * flow.
 */
export const BINDING_TRANSITIONS: Readonly<Record<BindingState, readonly BindingState[]>> = {
  draft: ['needs_review', 'superseded'],
  needs_review: ['approved', 'rejected', 'draft', 'superseded'],
  approved: ['superseded'],
  rejected: ['superseded'],
  superseded: [],
};

/** The states a transition into `target` may legally come from. */
export function statesAllowedToReach(target: BindingState): readonly BindingState[] {
  return (Object.keys(BINDING_TRANSITIONS) as BindingState[]).filter((from) =>
    BINDING_TRANSITIONS[from].includes(target),
  );
}

/**
 * Only an approved binding may drive a real action.
 *
 * The runtime checks this rather than trusting that whatever was loaded is
 * fit to use: a draft binding is a half-finished recording, and a rejected one
 * is a human saying no.
 */
export function isExecutable(state: BindingState): boolean {
  return state === 'approved';
}
