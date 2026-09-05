import { z } from 'zod';

/**
 * Phase 1 supports stable test-id locators only.
 *
 * Coordinate-based interaction is prohibited, and CSS/XPath strategies are
 * deferred: the controlled demo portal exposes stable `data-testid` values, so
 * a narrower contract is also a more deterministic one.
 */
export const locatorStrategySchema = z.enum(['test_id']);
export type LocatorStrategy = z.infer<typeof locatorStrategySchema>;

export const locatorSchema = z.strictObject({
  strategy: locatorStrategySchema,
  value: z.string().min(1),
});
export type Locator = z.infer<typeof locatorSchema>;
