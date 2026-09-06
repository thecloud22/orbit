import type { BrowserExecutor } from '@orbit/runtime';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPlaywrightExecutorFactory } from './playwright-executor';

/**
 * `describeElement` against a real browser and the real demo portal.
 *
 * The reason this test exists rather than a fake: the whole drift check rests
 * on the accessibility tree reporting a *computed* role. Reading the `role`
 * attribute instead would look correct in a unit test and be empty in practice,
 * because real controls almost never carry one. Only a real page proves it.
 */
/** The controlled Phase 1 target; the global setup guarantees it is running. */
const DEMO_PORTAL_URL = 'http://localhost:3001/requests';

describe('describeElement', () => {
  let executor: BrowserExecutor;

  beforeAll(async () => {
    executor = await createPlaywrightExecutorFactory({ headless: true }).open();
    await executor.navigate({ url: DEMO_PORTAL_URL, timeoutMs: 30_000 });
  }, 60_000);

  afterAll(async () => {
    await executor?.close();
  });

  it('reports the computed role of an element with no role attribute', async () => {
    const described = await executor.describeElement({
      locator: { strategy: 'test_id', value: 'search-request-button' },
      timeoutMs: 15_000,
    });

    // The portal's markup carries no role="button"; this role is computed.
    expect(described.role).toBe('button');
    expect(described.accessibleName).toBe('Search');
    expect(described.text).toBe('Search');
  });

  it('reports the accessible name of a labelled input', async () => {
    const described = await executor.describeElement({
      locator: { strategy: 'test_id', value: 'request-number-input' },
      timeoutMs: 15_000,
    });

    expect(described.role).toBe('textbox');
    expect(described.accessibleName).toBe('Service request number');
  });

  it('reports a position without depending on it', async () => {
    const described = await executor.describeElement({
      locator: { strategy: 'test_id', value: 'search-request-button' },
      timeoutMs: 15_000,
    });

    expect(described.boundingBox?.width).toBeGreaterThan(0);
    expect(described.boundingBox?.height).toBeGreaterThan(0);
  });

  it('resolves the same element through every locator strategy', async () => {
    // The point of a fallback chain: each strategy must reach the same element,
    // so a page that drops one attribute is still navigable by another.
    const byTestId = await executor.describeElement({
      locator: { strategy: 'test_id', value: 'search-request-button' },
      timeoutMs: 15_000,
    });

    const byRole = await executor.describeElement({
      locator: { strategy: 'role_and_name', value: 'button', name: 'Search' },
      timeoutMs: 15_000,
    });

    expect(byRole).toEqual(byTestId);
  });

  it('finds a field by its visible label', async () => {
    const byLabel = await executor.describeElement({
      locator: { strategy: 'label', value: 'Service request number' },
      timeoutMs: 15_000,
    });

    expect(byLabel.role).toBe('textbox');
  });

  it('fails loudly for an element that is not there', async () => {
    await expect(
      executor.describeElement({
        locator: { strategy: 'test_id', value: 'no-such-element' },
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow();
  });
});
