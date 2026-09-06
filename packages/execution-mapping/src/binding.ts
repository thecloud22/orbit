import { z } from 'zod';

import { elementFingerprintSchema } from './fingerprint';
import { selectorChainSchema } from './selectors';

/**
 * An Execution Binding: what one SOP step actually does on a real page.
 *
 * The SOP Graph says "the field labelled Password"; a binding says which
 * element that turned out to be, how to find it again, and what it looked like
 * when a human confirmed it. Keeping them apart is ADR-002 — business intent
 * and executable detail are two representations, and a graph still contains no
 * selector.
 *
 * Nothing here is inferred. A human demonstrated the step once and confirmed
 * the result; a binding is the record of that confirmation.
 */

/**
 * An element the binding acts on or reads from.
 *
 * `scope` is the answer to "which row?" and is absent from every binding this
 * sub-phase produces: single-record navigation holds for every workflow Orbit
 * can currently execute — the runtime has no iteration construct and Agent IR
 * has no loop. The field exists anyway because the SOP vocabulary already
 * expresses cardinality decisions, so lists are coming, and adding the field
 * later would mean reworking a schema that 2.5 and 2.6 had already compiled
 * against. See ADR-018.
 */
export const elementTargetSchema = z.strictObject({
  selectors: selectorChainSchema,
  fingerprint: elementFingerprintSchema,
  /** Absent today. When present, the target is resolved within this element. */
  scope: z
    .strictObject({
      selectors: selectorChainSchema,
      fingerprint: elementFingerprintSchema,
    })
    .optional(),
});
export type ElementTarget = z.infer<typeof elementTargetSchema>;

/**
 * Where a fill step's value comes from, chosen explicitly by a human.
 *
 * Never inferred, and never the value that was typed during recording. That
 * value exists only to prove the right field was hit and is discarded at the
 * confirm screen: persisting it would put a real, possibly sensitive, typed
 * value into a durable artifact that nothing in this phase is designed to
 * protect.
 */
export const valueSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('sop_variable'),
    /** An input or variable the graph already declares. Validated against it. */
    name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  }),
  z.strictObject({
    kind: z.literal('literal'),
    /** A default entered deliberately at binding time, not captured. */
    value: z.string(),
  }),
]);
export type ValueSource = z.infer<typeof valueSourceSchema>;

/** How a value is read off an element. */
export const readMethodSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text') }),
  z.strictObject({ kind: z.literal('attribute'), attribute: z.string().min(1) }),
  z.strictObject({ kind: z.literal('checked') }),
]);
export type ReadMethod = z.infer<typeof readMethodSchema>;

const bindingBase = {
  target: elementTargetSchema,
};

/**
 * The four bindable step kinds, plus the two read kinds.
 *
 * `manual_review` is absent by construction rather than by a check: there is
 * nothing to automate about routing to a human, so a binding for one is not a
 * thing this schema can express.
 */
export const bindingBodySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...bindingBase,
    kind: z.literal('navigate'),
    /** The URL the recording actually landed on. Still never fetched here. */
    url: z.string().min(1),
  }),
  z.strictObject({
    ...bindingBase,
    kind: z.literal('fill'),
    valueSource: valueSourceSchema,
  }),
  z.strictObject({ ...bindingBase, kind: z.literal('click') }),
  z.strictObject({
    ...bindingBase,
    kind: z.literal('extract'),
    readMethod: readMethodSchema,
    /** The graph variable this populates. Validated against the graph. */
    variable: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  }),
  z.strictObject({
    ...bindingBase,
    kind: z.literal('decision'),
    readMethod: readMethodSchema,
    /** The branch condition this reading feeds. */
    condition: z.string().min(1),
  }),
  z.strictObject({
    ...bindingBase,
    kind: z.literal('outcome'),
    readMethod: readMethodSchema,
    variable: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  }),
]);
export type BindingBody = z.infer<typeof bindingBodySchema>;
export type BindingKind = BindingBody['kind'];

/** Kinds that perform an action; the rest only read. */
export const ACTION_BINDING_KINDS = ['navigate', 'fill', 'click'] as const;

export const EXECUTION_BINDING_SCHEMA_VERSION = '0.1';

export const executionBindingSchema = z.strictObject({
  schemaVersion: z.string().min(1),
  /** The step this binds to, named the way the graph names it. */
  stepId: z.string().regex(/^[a-z][a-z0-9_]*$/),
  body: bindingBodySchema,
  /**
   * The revision the recording was made against, and a checksum of the bound
   * step as it read at that moment.
   *
   * A binding is keyed by step rather than by revision, so an unrelated edit
   * elsewhere in the graph leaves it intact. This checksum is what makes that
   * safe: when *this* step's content changes, the hash stops matching and the
   * binding is known to be stale — deterministically, with nothing inferred.
   */
  capturedAgainstRevisionId: z.string().min(1),
  stepSha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type ExecutionBinding = z.infer<typeof executionBindingSchema>;

/** Whether a binding's fingerprint should be compared as an action or a read. */
export function comparisonModeFor(kind: BindingKind): 'action' | 'read' {
  return (ACTION_BINDING_KINDS as readonly string[]).includes(kind) ? 'action' : 'read';
}
