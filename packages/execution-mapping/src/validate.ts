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
