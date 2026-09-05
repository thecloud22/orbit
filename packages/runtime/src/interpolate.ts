import { classifyInterpolation, type ReferenceNamespace } from '@orbit/agent-ir';

import { RuntimeError } from './errors';

/**
 * Restricted interpolation at run time (ADR-007).
 *
 * The runtime adds no parser and evaluates no code: it reuses
 * `classifyInterpolation` from @orbit/agent-ir, so what the validator accepted
 * at publish time and what the runtime resolves are the same grammar. A value is
 * a literal or exactly one whole-string reference — there is no concatenation,
 * no `eval`, no `Function`, and no dynamic import anywhere on this path.
 */

/** Which namespaces each position accepts; mirrors the semantic validator. */
const NAMESPACES_BY_POSITION = {
  value: ['inputs', 'variables'],
  expected: ['inputs', 'variables'],
  assign: ['result'],
  output: ['inputs', 'variables'],
} as const satisfies Record<string, readonly ReferenceNamespace[]>;

export type ValuePosition = keyof typeof NAMESPACES_BY_POSITION;

export interface ResolutionScope {
  readonly inputs: Readonly<Record<string, string>>;
  readonly variables: Readonly<Record<string, string>>;
  /** Present only while resolving an extract step's `assign` block. */
  readonly result?: Readonly<Record<string, string>>;
}

/**
 * Resolves one dynamic value.
 *
 * Every rejection here is `INTERNAL_ERROR` rather than a validation failure: the
 * semantic validator already proved these cases impossible for a version that
 * was accepted, so reaching one means the runtime and the validator disagree.
 * That is a defect in Orbit, and it fails loudly instead of resolving to
 * `undefined` and typing "undefined" into a browser field.
 */
export function resolveValue(
  raw: string,
  position: ValuePosition,
  scope: ResolutionScope,
  agentStepId: string,
): string {
  const classified = classifyInterpolation(raw);

  if (classified.kind === 'literal') {
    return classified.value;
  }

  if (classified.kind === 'malformed') {
    throw new RuntimeError({
      code: 'INTERNAL_ERROR',
      message: `Step "${agentStepId}" holds a malformed interpolation reference.`,
      details: [{ field: position, message: raw }],
      agentStepId,
    });
  }

  const { namespace, name } = classified.reference;
  const allowed: readonly ReferenceNamespace[] = NAMESPACES_BY_POSITION[position];

  if (!allowed.includes(namespace)) {
    throw new RuntimeError({
      code: 'INTERNAL_ERROR',
      message: `Step "${agentStepId}" reads \${${namespace}.${name}} where it is not permitted.`,
      details: [{ field: position, message: raw }],
      agentStepId,
    });
  }

  const source =
    namespace === 'inputs'
      ? scope.inputs
      : namespace === 'variables'
        ? scope.variables
        : scope.result;
  const resolved = source?.[name];

  if (resolved === undefined) {
    throw new RuntimeError({
      code: 'INTERNAL_ERROR',
      message: `Step "${agentStepId}" reads \${${namespace}.${name}}, which has no value at this point in the run.`,
      details: [{ field: position, message: raw }],
      agentStepId,
    });
  }

  return resolved;
}
