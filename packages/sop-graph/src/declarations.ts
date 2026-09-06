import { z } from 'zod';

/**
 * Declared values an SOP Graph names.
 *
 * A graph declares the inputs a future run would supply and the variables its
 * own extraction steps produce. Nothing here carries a value: a declaration
 * says what a thing is called and what shape it has, never what it contains.
 */

/** Identifiers shared by inputs, variables, and outputs. */
export const identifierSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/);

/**
 * The whole supported input type vocabulary.
 *
 * Deliberately six members. Arbitrary JSON, files, nested objects, and
 * expression types are excluded: a first version that cannot express them
 * cannot accidentally require an evaluator to interpret them.
 */
export const inputTypeSchema = z.enum(['string', 'number', 'boolean', 'enum', 'date', 'secret']);
export type InputType = z.infer<typeof inputTypeSchema>;

const inputBase = {
  id: identifierSchema,
  label: z.string().min(1),
  description: z.string().min(1).optional(),
  required: z.boolean(),
};

/**
 * Input declarations, discriminated on `type` so each kind carries only the
 * constraints that mean something for it — a `minLength` on a boolean is not a
 * value this schema can express.
 */
export const inputDeclarationSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...inputBase,
    type: z.literal('string'),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().positive().optional(),
    example: z.string().optional(),
    default: z.string().optional(),
  }),
  z.strictObject({
    ...inputBase,
    type: z.literal('number'),
    min: z.number().optional(),
    max: z.number().optional(),
    example: z.number().optional(),
    default: z.number().optional(),
  }),
  z.strictObject({
    ...inputBase,
    type: z.literal('boolean'),
    example: z.boolean().optional(),
    default: z.boolean().optional(),
  }),
  z.strictObject({
    ...inputBase,
    type: z.literal('enum'),
    values: z.array(z.string().min(1)).min(1),
    example: z.string().optional(),
    default: z.string().optional(),
  }),
  z.strictObject({
    ...inputBase,
    type: z.literal('date'),
    /** ISO-8601 calendar dates; a draft never carries a parsed date object. */
    example: z.string().optional(),
    default: z.string().optional(),
  }),
  /**
   * A secret is an ordinary declared input with one marker and no value
   * carrier: it has no `example` and no `default`, so the schema itself makes
   * a literal secret unrepresentable rather than relying on a later check.
   */
  z.strictObject({
    ...inputBase,
    type: z.literal('secret'),
  }),
]);
export type InputDeclaration = z.infer<typeof inputDeclarationSchema>;

/** The type of a value an extraction or decision step produces. */
export const producedTypeSchema = z.enum(['string', 'number', 'boolean', 'date']);
export type ProducedType = z.infer<typeof producedTypeSchema>;

export const producedValueSchema = z.strictObject({
  name: identifierSchema,
  type: producedTypeSchema,
  description: z.string().min(1).optional(),
});
export type ProducedValue = z.infer<typeof producedValueSchema>;

/** A value the graph promises to return, named so a reviewer can check it. */
export const outputDeclarationSchema = z.strictObject({
  name: identifierSchema,
  label: z.string().min(1),
  description: z.string().min(1).optional(),
});
export type OutputDeclaration = z.infer<typeof outputDeclarationSchema>;
