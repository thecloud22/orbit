/**
 * How a step names a value it consumes.
 *
 * An SOP Graph has no expression language, and this is where that is decided. A
 * value is a literal string or exactly one whole-string reference — never a
 * template that concatenates the two, never an expression, never anything that
 * would need an evaluator to interpret. The grammar is deliberately identical
 * in spirit to Agent IR's, but it is re-implemented rather than imported:
 * ADR-002 keeps the business-intent and execution representations independent,
 * and importing one into the other is exactly how that separation erodes.
 */

export const REFERENCE_PATTERN = /^\$\{(inputs|variables)\.([A-Za-z][A-Za-z0-9_]*)\}$/;

export const REFERENCE_NAMESPACES = ['inputs', 'variables'] as const;
export type ReferenceNamespace = (typeof REFERENCE_NAMESPACES)[number];

export interface ValueReference {
  readonly namespace: ReferenceNamespace;
  readonly name: string;
  readonly raw: string;
}

/**
 * A value is a reference, a plain literal, or malformed.
 *
 * `malformed` exists so a typo such as `${inputs.requestNumber` is reported as
 * an error rather than silently accepted as literal text that a reviewer would
 * then approve as if it meant something.
 */
export type ClassifiedValue =
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'reference'; readonly reference: ValueReference }
  | { readonly kind: 'malformed'; readonly value: string };

export function classifyValue(value: string): ClassifiedValue {
  const match = REFERENCE_PATTERN.exec(value);
  const namespace = match?.[1];
  const name = match?.[2];

  if (namespace !== undefined && name !== undefined) {
    return {
      kind: 'reference',
      reference: { namespace: namespace as ReferenceNamespace, name, raw: value },
    };
  }

  if (value.includes('${')) {
    return { kind: 'malformed', value };
  }

  return { kind: 'literal', value };
}
