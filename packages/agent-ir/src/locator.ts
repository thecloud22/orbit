import { z } from 'zod';

/**
 * The closed locator vocabulary.
 *
 * Three strategies, all of which name an element by something a person can
 * read on the page: its test id, its accessible role and name, or its form
 * label. CSS and XPath are deliberately absent, and coordinate-based
 * interaction is prohibited outright.
 *
 * That absence is the point. A raw selector string is a small program for
 * walking the DOM, and once one can be expressed, "no arbitrary selectors"
 * becomes a convention rather than a property of the type. Every strategy here
 * takes a value that describes the element, never a path to it.
 *
 * `role_and_name` and `label` were added in sub-phase 2.4 so an Execution
 * Binding can carry a ranked fallback chain: a single test id has nothing to
 * fall back to, and a page that drops one is exactly when a second way of
 * naming the same element earns its keep. See ADR-018.
 */
export const locatorStrategySchema = z.enum(['test_id', 'role_and_name', 'label']);
export type LocatorStrategy = z.infer<typeof locatorStrategySchema>;

/**
 * `name` is meaningful only for `role_and_name`, where `value` is the ARIA role
 * and `name` is the accessible name. The other two strategies carry `value`
 * alone.
 */
export const locatorSchema = z.strictObject({
  strategy: locatorStrategySchema,
  value: z.string().min(1),
  name: z.string().min(1).optional(),
});
export type Locator = z.infer<typeof locatorSchema>;
