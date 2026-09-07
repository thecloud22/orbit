import { z } from 'zod';

import { executionBindingSchema, type ExecutionBinding } from './binding';

/**
 * Validating a binding against the graph it claims to bind to.
 *
 * A binding is only meaningful next to its step: it must name a step that
 * exists, of a kind that can be bound at all, and any variable it populates or
 * reads must be one the graph actually declares. None of that is checkable from
 * the binding alone, so the caller supplies a minimal description of the step
 * rather than this package importing @orbit/sop-graph — which would couple the
 * executable detail back to the business representation, against ADR-002.
 */

export const BINDING_ISSUE_CODES = [
  'SCHEMA_ERROR',
  'UNKNOWN_STEP',
  'STEP_KIND_MISMATCH',
  'STEP_NOT_BINDABLE',
  'UNDECLARED_VARIABLE',
  'STALE_BINDING',
  'BRANCH_MISMATCH',
] as const;

export type BindingIssueCode = (typeof BINDING_ISSUE_CODES)[number];

export interface BindingIssue {
  readonly code: BindingIssueCode;
  readonly message: string;
  readonly path: readonly (string | number)[];
}

/** What the caller must tell us about the step, without importing the graph. */
export interface BoundStepDescription {
  readonly stepId: string;
  readonly kind: string;
  /** Every input and variable name the graph declares. */
  readonly declaredNames: readonly string[];
  /** Checksum of the step as it reads now, to detect a stale binding. */
  readonly stepSha256: string;
  /**
   * For a `decision`: the `when` text of every branch the step declares.
   *
   * Supplied by the caller for the same reason everything else here is — this
   * package must not import @orbit/sop-graph (ADR-002). Absent for every other
   * kind, and absent is not the same as empty: an omitted list means "not a
   * decision", and a decision binding is checked against it regardless, so a
   * caller that forgets to pass it gets a refusal rather than a pass.
   */
  readonly branchConditions?: readonly string[];
}

/**
 * `manual_review` is not bindable, and this is the one place that is stated.
 *
 * There is nothing to automate about handing work to a person, so a binding for
 * one is not merely unnecessary — it would imply the step does something a
 * browser can perform, which is exactly the confusion the step kind exists to
 * prevent.
 */
export const NON_BINDABLE_STEP_KINDS = ['manual_review'] as const;

export function isBindableStepKind(kind: string): boolean {
  return !(NON_BINDABLE_STEP_KINDS as readonly string[]).includes(kind);
}

export type ParseBindingResult =
  | { readonly ok: true; readonly binding: ExecutionBinding }
  | { readonly ok: false; readonly issues: readonly BindingIssue[] };

export function parseExecutionBinding(document: unknown): ParseBindingResult {
  const parsed = executionBindingSchema.safeParse(document);

  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        code: 'SCHEMA_ERROR' as const,
        message: issue.message,
        path: issue.path.map((segment) =>
          typeof segment === 'symbol' ? String(segment) : segment,
        ),
      })),
    };
  }

  return { ok: true, binding: parsed.data };
}

export function validateBindingAgainstStep(
  binding: ExecutionBinding,
  step: BoundStepDescription | undefined,
): readonly BindingIssue[] {
  const issues: BindingIssue[] = [];

  if (step === undefined) {
    return [
      {
        code: 'UNKNOWN_STEP',
        message: `The workflow has no step "${binding.stepId}".`,
        path: ['stepId'],
      },
    ];
  }

  if (!isBindableStepKind(step.kind)) {
    issues.push({
      code: 'STEP_NOT_BINDABLE',
      message: `A "${step.kind}" step routes to a person and has nothing to automate, so it takes no binding.`,
      path: ['stepId'],
    });
    // Nothing further is meaningful once the step should not be bound at all.
    return issues;
  }

  if (step.kind !== binding.body.kind) {
    issues.push({
      code: 'STEP_KIND_MISMATCH',
      message: `This binding describes a "${binding.body.kind}" action, but step "${binding.stepId}" is a "${step.kind}" step.`,
      path: ['body', 'kind'],
    });
  }

  issues.push(...branchIssues(binding, step));

  for (const [name, path] of referencedNames(binding)) {
    if (!step.declaredNames.includes(name)) {
      issues.push({
        code: 'UNDECLARED_VARIABLE',
        message: `"${name}" is not declared by the workflow.`,
        path,
      });
    }
  }

  if (binding.stepSha256 !== step.stepSha256) {
    issues.push({
      code: 'STALE_BINDING',
      message: `Step "${binding.stepId}" has changed since this binding was recorded, so it must be re-recorded before it is used.`,
      path: ['stepSha256'],
    });
  }

  return issues;
}

/**
 * A decision binding's branches, against the branches the step declares.
 *
 * Exact set equality, in both directions. A branch the graph declares and the
 * binding does not is a branch the workflow could take and the agent could not
 * resolve; a branch the binding carries and the graph does not is an element
 * demonstrated for a condition that no longer exists. Neither is safe to
 * compile, and reporting only one of them would let the other through.
 */
function branchIssues(
  binding: ExecutionBinding,
  step: BoundStepDescription,
): readonly BindingIssue[] {
  if (binding.body.kind !== 'decision' || step.kind !== 'decision') {
    return [];
  }

  const declared = new Set(step.branchConditions ?? []);
  const bound = new Set(binding.body.branches.map((branch) => branch.when));

  const missing = [...declared].filter((when) => !bound.has(when));
  const extra = [...bound].filter((when) => !declared.has(when));

  if (missing.length === 0 && extra.length === 0) {
    return [];
  }

  const parts: string[] = [];

  if (missing.length > 0) {
    parts.push(`nothing was demonstrated for ${missing.map((when) => `"${when}"`).join(', ')}`);
  }

  if (extra.length > 0) {
    parts.push(
      `${extra.map((when) => `"${when}"`).join(', ')} ${extra.length === 1 ? 'is' : 'are'} no longer a branch of this step`,
    );
  }

  return [
    {
      code: 'BRANCH_MISMATCH',
      message: `This binding does not cover step "${binding.stepId}" exactly: ${parts.join('; ')}.`,
      path: ['body', 'branches'],
    },
  ];
}

/** Every graph name a binding depends on, with where it appears. */
function referencedNames(
  binding: ExecutionBinding,
): readonly (readonly [string, readonly (string | number)[]])[] {
  const body = binding.body;

  if (body.kind === 'fill' && body.valueSource.kind === 'sop_variable') {
    return [[body.valueSource.name, ['body', 'valueSource', 'name']]];
  }

  if (body.kind === 'extract' || body.kind === 'outcome') {
    return [[body.variable, ['body', 'variable']]];
  }

  return [];
}

/** Convenience for callers that want one answer. */
export function isBindingUsable(
  binding: ExecutionBinding,
  step: BoundStepDescription | undefined,
): boolean {
  return validateBindingAgainstStep(binding, step).length === 0;
}

export const bindingIssueSchema = z.strictObject({
  code: z.enum(BINDING_ISSUE_CODES),
  message: z.string(),
  path: z.array(z.union([z.string(), z.number()])),
});
