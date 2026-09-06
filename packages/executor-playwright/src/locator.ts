import type { Locator } from '@orbit/agent-ir';
import { RuntimeError } from '@orbit/runtime';
import type { Locator as PlaywrightLocator, Page } from 'playwright';

/**
 * Resolves an Agent IR locator to a Playwright locator.
 *
 * This is the only place a locator becomes something the browser can act on,
 * and it accepts nothing but the closed vocabulary: a test id, an accessible
 * role and name, or a form label. There is no path here from a string to a CSS
 * or XPath selector, which is what makes "no arbitrary selectors" a property of
 * the code rather than a convention.
 *
 * `role_and_name` and `label` arrived with sub-phase 2.4's selector fallback
 * chains (ADR-018). Each still names an element by something a person can read
 * on the page, never by a path through the DOM.
 */
export function resolveLocator(page: Page, locator: Locator): PlaywrightLocator {
  switch (locator.strategy) {
    case 'test_id':
      return page.getByTestId(locator.value);

    case 'role_and_name': {
      // Playwright's role union is wider than anything Orbit validates, and an
      // unknown role would otherwise resolve to nothing at all. The cast is
      // confined to this line; the value itself came from a page Playwright
      // reported, never from free text.
      const role = locator.value as Parameters<Page['getByRole']>[0];
      return locator.name === undefined
        ? page.getByRole(role)
        : page.getByRole(role, { name: locator.name, exact: true });
    }

    case 'label':
      return page.getByLabel(locator.value, { exact: true });

    default: {
      // Unreachable while the three strategies above are the whole vocabulary;
      // kept so adding one to the contract without implementing it fails loudly
      // instead of silently.
      const unsupported: never = locator.strategy;
      throw new RuntimeError({
        code: 'VALIDATION_ERROR',
        message: `Locator strategy "${String(unsupported)}" is not implemented by the Playwright executor.`,
      });
    }
  }
}
