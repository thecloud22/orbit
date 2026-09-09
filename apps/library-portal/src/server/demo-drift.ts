/**
 * The drift demo switch — opt-in, off by default, and never left on.
 *
 * Recovery is only demonstrable against a page that has actually changed, and
 * the honest change is the ordinary one: somebody renames a `data-testid` while
 * the button itself — its role, its label, its position — stays exactly as it
 * was. That is the case a recorded binding's fallback chain can still explain,
 * and the case Orbit proposes a repair for (ADR-033).
 *
 * Driven by a query parameter rather than a build flag or an edit to revert, so
 * the portal in this repository is never a drifted portal. `?drift=1` renames
 * one test id for that page load; every other visitor, and every existing test,
 * sees the page unchanged. There is nothing to undo afterwards.
 *
 * A run reaches it the same way a person does: an agent whose navigate step
 * targets `/catalog?drift=1` will find the renamed element, because the URL is
 * part of what was recorded.
 */
const DRIFTED_TEST_IDS: Readonly<Record<string, string>> = {
  // The Search button, which every run of the borrow-or-hold workflow clicks.
  // Only the attribute moves: the accessible role stays `button`, the
  // accessible name stays "Search", and the visible label stays "Search" — so
  // the binding's `role_and_name` fallback still finds exactly the element that
  // was approved, which is what makes a confident diagnosis possible at all.
  'catalog-search-button': 'catalog-search-submit',
};

export function isDriftDemoEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return new URLSearchParams(window.location.search).get('drift') === '1';
}

/** The test id this element renders with, given whether the demo is on. */
export function driftedTestId(testId: string): string {
  return isDriftDemoEnabled() ? (DRIFTED_TEST_IDS[testId] ?? testId) : testId;
}
