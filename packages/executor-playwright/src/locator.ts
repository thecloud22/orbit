import type { Locator } from '@orbit/agent-ir';
import { RuntimeError } from '@orbit/runtime';
import type { Locator as PlaywrightLocator, Page } from 'playwright';

/**
 * Resolves an Agent IR locator to a Playwright locator.
 *
 * This is the only place a locator becomes something the browser can act on,
 * and it accepts nothing but the closed `test_id` strategy. There is no path
 * here from a string to a CSS or XPath selector, which is what makes "no
 * arbitrary selectors" a property of the code rather than a convention.
 * Playwright's default test id attribute is `data-testid`, which is what the
 * demo portal exposes.
 */
export function resolveLocator(page: Page, locator: Locator): PlaywrightLocator {
  switch (locator.strategy) {
    case 'test_id':
      return page.getByTestId(locator.value);
    default: {
      // Unreachable while `test_id` is the only strategy; kept so adding one to
      // the contract without implementing it fails loudly instead of silently.
      const unsupported: never = locator.strategy;
      throw new RuntimeError({
        code: 'VALIDATION_ERROR',
        message: `Locator strategy "${String(unsupported)}" is not implemented by the Playwright executor.`,
      });
    }
  }
}
