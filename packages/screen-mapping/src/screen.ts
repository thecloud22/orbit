import { z } from 'zod';

/**
 * What a 3270 screen is, as a structure rather than as pixels.
 *
 * A 3270 data stream does not describe a picture. It describes a buffer of
 * fields, each starting at a position and carrying attributes that say whether
 * it is protected, numeric, or non-display. That is the whole reason this
 * surface fits Orbit: a green screen already has the structured element model a
 * webpage has to be coaxed into providing, and it is more stable — screens
 * change on release cycles measured in years.
 *
 * Nothing here knows how the screen arrived. The model is populated by whatever
 * drives the terminal, so the transport can change without touching any of this
 * (ADR-037, TASK-P3-000).
 */

/** A position on the buffer. Rows and columns are 0-indexed from the top left. */
export const screenPositionSchema = z.strictObject({
  row: z.number().int().min(0),
  column: z.number().int().min(0),
});
export type ScreenPosition = z.infer<typeof screenPositionSchema>;

/**
 * A field's attributes, as the data stream declares them.
 *
 * `nonDisplay` is the one worth naming carefully. On 3270 it is a *field
 * attribute*, not a heuristic: the host says a field is not to be displayed, and
 * that is how password fields are marked. Orbit can therefore identify a
 * credential field structurally rather than by guessing from a label — which is
 * strictly better than the browser recorder, whose known limitation is that it
 * detects password *inputs* rather than secrets.
 *
 * It transmits in clear regardless. Redaction is Orbit's job, driven off this
 * flag; the wire does not do it.
 */
export const fieldAttributesSchema = z.strictObject({
  /** The host will not accept input into this field. */
  protected: z.boolean(),
  /** The host expects digits. Recorded, never enforced by Orbit. */
  numeric: z.boolean(),
  /** Not rendered. This is how a password field is marked. */
  nonDisplay: z.boolean(),
  /** Rendered with emphasis. Recorded for the fingerprint, never acted on. */
  intensified: z.boolean(),
});
export type FieldAttributes = z.infer<typeof fieldAttributesSchema>;

export const screenFieldSchema = z.strictObject({
  start: screenPositionSchema,
  /** Length in characters, excluding the attribute byte itself. */
  length: z.number().int().min(0),
  attributes: fieldAttributesSchema,
  /**
   * The field's current content, right-trimmed.
   *
   * Present for every field including non-display ones, because the host sends
   * it and pretending otherwise would hide what is really on the wire. Anything
   * that persists a screen must consult `attributes.nonDisplay` first.
   */
  text: z.string(),
});
export type ScreenField = z.infer<typeof screenFieldSchema>;

export const screenSchema = z.strictObject({
  /** Geometry, e.g. 24x80 for a 3278-2. Part of the fingerprint: a binding
   * recorded against one model is not valid against another. */
  rows: z.number().int().positive(),
  columns: z.number().int().positive(),
  fields: z.array(screenFieldSchema),
  cursor: screenPositionSchema.nullable(),
});
export type Screen = z.infer<typeof screenSchema>;

/** Fields a person can type into: unprotected, in buffer order. */
export function inputFields(screen: Screen): readonly ScreenField[] {
  return screen.fields.filter((field) => !field.attributes.protected);
}

/** Buffer order — top to bottom, left to right — regardless of how they arrived. */
export function fieldsInBufferOrder(screen: Screen): readonly ScreenField[] {
  return [...screen.fields].sort((left, right) =>
    left.start.row === right.start.row
      ? left.start.column - right.start.column
      : left.start.row - right.start.row,
  );
}
