import { z } from 'zod';

import { locatorSchema } from './locator';

/**
 * Phase 1 assertion types. `expected` on `locator_has_text` may be a literal or
 * a restricted interpolation reference; which references are legal there is
 * enforced by the semantic validator, not by this structural schema.
 */
export const assertionSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('locator_visible'),
    locator: locatorSchema,
  }),
  z.strictObject({
    type: z.literal('locator_has_text'),
    locator: locatorSchema,
    expected: z.string().min(1),
  }),
]);
export type Assertion = z.infer<typeof assertionSchema>;
