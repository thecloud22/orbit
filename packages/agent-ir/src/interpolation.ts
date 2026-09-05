/**
 * Restricted interpolation (ADR-007).
 *
 * Orbit deliberately has no expression language. A dynamic value is either a
 * literal string or exactly one whole-string reference — never a template that
 * concatenates the two — so nothing can construct an arbitrary string, and
 * there is no `eval`, `Function`, or dynamic import anywhere in the pipeline.
 */

export const REFERENCE_PATTERN = /^\$\{(inputs|variables|result)\.([A-Za-z][A-Za-z0-9_]*)\}$/;

export const REFERENCE_NAMESPACES = ['inputs', 'variables', 'result'] as const;
export type ReferenceNamespace = (typeof REFERENCE_NAMESPACES)[number];

export interface InterpolationReference {
  readonly namespace: ReferenceNamespace;
  readonly name: string;
  readonly raw: string;
}

/**
 * A value is a reference, a plain literal, or malformed.
 *
 * `malformed` exists so that a typo such as `${inputs.requestNumber` is
 * reported as an error rather than silently accepted as a literal string and
 * typed into a browser field at run time.
 */
export type InterpolationValue =
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'reference'; readonly reference: InterpolationReference }
  | { readonly kind: 'malformed'; readonly value: string };

export function classifyInterpolation(value: string): InterpolationValue {
  const match = REFERENCE_PATTERN.exec(value);
  const namespace = match?.[1];
  const name = match?.[2];

  if (namespace !== undefined && name !== undefined) {
    return {
      kind: 'reference',
      reference: {
        namespace: namespace as ReferenceNamespace,
        name,
        raw: value,
      },
    };
  }

  if (value.includes('${')) {
    return { kind: 'malformed', value };
  }

  return { kind: 'literal', value };
}
