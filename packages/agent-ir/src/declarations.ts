import { z } from 'zod';

/**
 * Declared inputs, variables, and outputs.
 *
 * Phase 1 supports a single value type. Keeping `type` an enum rather than a
 * bare literal means adding number/boolean/date later widens the contract
 * without reshaping it.
 */
export const valueTypeSchema = z.enum(['string']);
export type ValueType = z.infer<typeof valueTypeSchema>;

/** Declaration names share the interpolation grammar's identifier rules. */
export const identifierSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/);

export const inputValidationSchema = z.strictObject({
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().positive().optional(),
});
export type InputValidation = z.infer<typeof inputValidationSchema>;

export const inputDeclarationSchema = z.strictObject({
  type: valueTypeSchema,
  required: z.boolean(),
  label: z.string().min(1),
  description: z.string().min(1).optional(),
  validation: inputValidationSchema.optional(),
  examples: z.array(z.string()).optional(),
});
export type InputDeclaration = z.infer<typeof inputDeclarationSchema>;

export const variableDeclarationSchema = z.strictObject({ type: valueTypeSchema });
export type VariableDeclaration = z.infer<typeof variableDeclarationSchema>;

/**
 * Declares the shape and type of the outputs an agent may produce. A terminal
 * step supplies a subset: `request_not_found` legitimately has no status or
 * assigned team, which the SOP records as "required when found".
 */
export const outputDeclarationSchema = z.strictObject({ type: valueTypeSchema });
export type OutputDeclaration = z.infer<typeof outputDeclarationSchema>;
