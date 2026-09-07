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
 * One branch of a decision, and the element that proves it was taken.
 *
 * A decision is bound by demonstrating each branch in turn: put the page into
 * that state, then point at the element that only appears in it. `when` is the
 * graph branch's own condition text, which is how a branch binding is matched
 * back to the branch it describes — by the reviewer's words rather than by
 * array position, so reordering the graph's branches cannot silently rebind a
 * decision to the wrong outcome.
 */
export const decisionBranchBindingSchema = z.strictObject({
  when: z.string().min(1),
  selectors: selectorChainSchema,
  fingerprint: elementFingerprintSchema,
});
export type DecisionBranchBinding = z.infer<typeof decisionBranchBindingSchema>;

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
  /**
   * A decision carries one element *per branch*, and no `target` at all.
   *
   * It used to be `{target, readMethod, condition}` — read one value, evaluate
   * a predicate — which nothing could execute: the runtime has no expression
   * evaluator and never will (arbitrary expressions are excluded by CLAUDE.md).
   * What it *does* have is `browser.expect_one_of`, which waits for whichever
   * of several known page states appears and branches on that. So a decision is
   * bound the way the runtime can actually resolve it: one locator per branch.
   *
   * The branches live inside this one body rather than as one binding per
   * branch because a binding is keyed by step — `listCurrent` keeps exactly one
   * live binding per `stepId` — so a per-branch row would make every branch
   * supersede the last.
   */
  z.strictObject({
    kind: z.literal('decision'),
    branches: z.array(decisionBranchBindingSchema).min(2),
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

/**
 * 0.2: the `decision` body carries one element per branch (see above).
 *
 * The version is stored per binding and read as an opaque string, so rows
 * written at 0.1 still parse — every other body kind is unchanged, and no
 * decision binding could exist at 0.1 because nothing could create one.
 */
export const EXECUTION_BINDING_SCHEMA_VERSION = '0.2';

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

/**
 * Every element a binding names, in order.
 *
 * One for every kind but `decision`, which names one per branch. Callers that
 * used to reach for `body.target` go through this instead, so adding a body
 * with a different element arity again does not silently break them.
 */
export function bindingTargets(body: BindingBody): readonly ElementTarget[] {
  return body.kind === 'decision'
    ? body.branches.map((branch) => ({
        selectors: branch.selectors,
        fingerprint: branch.fingerprint,
      }))
    : [body.target];
}
