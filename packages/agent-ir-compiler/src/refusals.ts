/**
 * Why a document could not become candidate Agent IR.
 *
 * Every refusal names a reason and the step it concerns. That matters more here
 * than almost anywhere else in Orbit: the answer to "why can my workflow not
 * run?" is the whole product surface of this sub-phase, and "compilation
 * failed" is not an answer. A person reading one of these should be able to act
 * on it without opening the code.
 *
 * Refusals are collected rather than thrown one at a time. Someone fixing a
 * recorded workflow wants the whole list, not to rediscover the next problem
 * after every edit.
 */

export const COMPILE_REFUSAL_CODES = [
  /** A branch of a `decision` step nobody has demonstrated on a page. */
  'missing_branch_binding',
  /** A branch that names a step this workflow does not contain. */
  'unresolved_branch_target',
  /**
   * A judged decision with nowhere to go when the evidence does not settle it.
   *
   * A refusal rather than a warning, deliberately (ADR-032). A judged step whose
   * branches are all confident answers forces one for a record carrying no
   * evidence either way, and that answer is indistinguishable in the run's
   * evidence from a correct one. It is the shape that produces confident wrong
   * answers at scale, so it must not compile.
   */
  'missing_insufficient_evidence_branch',
  /** Two branches of a judged decision whose conditions collapse to one name. */
  'ambiguous_branch_outcome',
  /** A `manual_review` step: routing to a human has no executable form. */
  'manual_review_unsupported',
  /** A step that needs an approved binding and has none. */
  'missing_binding',
  /** The bound step has changed since the binding was recorded. */
  'stale_binding',
  /** An extract step declares more fields than its one binding can cover. */
  'extract_coverage_gap',
  /** An outcome step whose name cannot be a business outcome (ADR-030). */
  'unusable_outcome_name',
  /** An input whose declared type Agent IR cannot yet express. */
  'unsupported_input_type',
  /** A fill whose value source cannot produce a value Agent IR accepts. */
  'unusable_value_source',
  /** A navigate step with no destination at all. */
  'missing_destination',
  /** The compiler produced something that is not valid Agent IR. */
  'invalid_candidate',
] as const;

export type CompileRefusalCode = (typeof COMPILE_REFUSAL_CODES)[number];

export interface CompileRefusal {
  readonly code: CompileRefusalCode;
  /** The graph step this is about, when it is about one. */
  readonly stepId?: string;
  /** Plain language, addressed to whoever has to fix it. */
  readonly message: string;
}

export function refusal(
  code: CompileRefusalCode,
  message: string,
  stepId?: string,
): CompileRefusal {
  return stepId === undefined ? { code, message } : { code, stepId, message };
}
