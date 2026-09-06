import { locatorSchema, type Locator } from '@orbit/agent-ir';
import { z } from 'zod';

/**
 * How a binding names an element, in the order it should be tried.
 *
 * A single locator has nothing to fall back to, and a page that drops one
 * attribute is exactly when a second way of naming the same element earns its
 * keep. The chain is ordered by robustness, most stable first, and the runtime
 * tries each in turn.
 *
 * The vocabulary is @orbit/agent-ir's closed `Locator`, so a binding cannot
 * express a CSS or XPath selector any more than an Agent IR step can. That is
 * the whole reason this reuses the existing type rather than defining a looser
 * one for recording and narrowing it later.
 */
export const selectorChainSchema = z.array(locatorSchema).min(1).max(4);
export type SelectorChain = z.infer<typeof selectorChainSchema>;

/** The locator a binding prefers; the rest are fallbacks, in order. */
export function primarySelector(chain: SelectorChain): Locator {
  const first = chain[0];

  if (first === undefined) {
    // Unreachable while the schema enforces a minimum of one, and kept so a
    // future relaxation fails loudly rather than silently resolving nothing.
    throw new Error('A selector chain must contain at least one locator.');
  }

  return first;
}

/** A stable, readable description of a locator, for events and messages. */
export function describeSelector(locator: Locator): string {
  return locator.strategy === 'role_and_name'
    ? `${locator.strategy}=${locator.value}${locator.name === undefined ? '' : ` "${locator.name}"`}`
    : `${locator.strategy}=${locator.value}`;
}
