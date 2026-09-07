import { expect, test } from '@playwright/test';

test.describe('site chrome', () => {
  test('the header nav and footer appear on the homepage', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('site-nav-catalog')).toBeVisible();
    await expect(page.getByTestId('site-nav-circulation')).toBeVisible();
    await expect(page.getByTestId('site-nav-hours')).toBeVisible();
    await expect(page.getByTestId('site-nav-events')).toBeVisible();
    await expect(page.getByTestId('site-footer')).toBeVisible();
  });

  test('the same header nav appears on an inner page', async ({ page }) => {
    await page.goto('/catalog');

    await expect(page.getByTestId('site-nav-home')).toBeVisible();
    await expect(page.getByTestId('site-footer')).toBeVisible();
  });

  test('an unknown path shows a not-found page with a way home', async ({ page }) => {
    await page.goto('/no-such-page');

    await expect(page.getByText('Page not found')).toBeVisible();
    await page.getByText('Return to the homepage').click();
    await expect(page).toHaveURL('/');
  });
});

test.describe('home', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('shows the quick links to every page', async ({ page }) => {
    await expect(page.getByTestId('home-link-catalog')).toBeVisible();
    await expect(page.getByTestId('home-link-circulation')).toBeVisible();
    await expect(page.getByTestId('home-link-hours')).toBeVisible();
    await expect(page.getByTestId('home-link-events')).toBeVisible();
  });

  test('shows announcements', async ({ page }) => {
    await expect(page.getByTestId('home-announcements')).toBeVisible();
  });

  test('the hero search deep-links into the catalog page with results', async ({ page }) => {
    await page.getByTestId('home-search-input').fill('Clean Code');
    await page.getByTestId('home-search-button').click();

    await expect(page).toHaveURL('/catalog?q=Clean%20Code');
    await expect(page.getByTestId('catalog-result-title')).toHaveText('Clean Code');
  });

  test('an empty hero search lands on the catalog page browsing all titles', async ({ page }) => {
    await page.getByTestId('home-search-button').click();

    await expect(page).toHaveURL('/catalog');
    await expect(page.getByTestId('catalog-page-info')).toHaveText('Showing 1–10 of 100');
  });
});

test.describe('catalog search', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/catalog');
  });

  test('shows the first page of the full 100-title catalog by default', async ({ page }) => {
    await expect(page.getByTestId('catalog-result-item')).toHaveCount(10);
    await expect(page.getByTestId('catalog-page-info')).toHaveText('Showing 1–10 of 100');
    await expect(page.getByTestId('catalog-prev-page')).toBeDisabled();
    await expect(page.getByTestId('catalog-next-page')).toBeEnabled();
  });

  test('paging forward and back moves through the catalog', async ({ page }) => {
    await page.getByTestId('catalog-next-page').click();
    await expect(page.getByTestId('catalog-page-info')).toHaveText('Showing 11–20 of 100');

    await page.getByTestId('catalog-prev-page').click();
    await expect(page.getByTestId('catalog-page-info')).toHaveText('Showing 1–10 of 100');
  });

  test('a title search returns matching rows', async ({ page }) => {
    await page.getByTestId('catalog-search-input').fill('Clean Code');
    await page.getByTestId('catalog-search-button').click();

    await expect(page.getByTestId('catalog-results')).toBeVisible();
    await expect(page.getByTestId('catalog-result-title')).toHaveText('Clean Code');
    await expect(page.getByTestId('catalog-result-status')).toHaveText('Available');
  });

  test('an ISBN search returns the on-loan item with its due date', async ({ page }) => {
    await page.getByTestId('catalog-search-input').fill('978-0-201-63361-0');
    await page.getByTestId('catalog-search-button').click();

    await expect(page.getByTestId('catalog-result-status')).toHaveText('On loan · due 2024-06-20');
  });

  test('an unmatched query shows the no-results notice', async ({ page }) => {
    await page.getByTestId('catalog-search-input').fill('nothing like this exists');
    await page.getByTestId('catalog-search-button').click();

    await expect(page.getByTestId('catalog-no-results')).toBeVisible();
    await expect(page.getByTestId('catalog-results')).toHaveCount(0);
  });

  test('submitting a new search resets to page 1', async ({ page }) => {
    await page.getByTestId('catalog-next-page').click();
    await expect(page.getByTestId('catalog-page-info')).toHaveText('Showing 11–20 of 100');

    await page.getByTestId('catalog-search-input').fill('Clean Code');
    await page.getByTestId('catalog-search-button').click();

    await expect(page.getByTestId('catalog-page-info')).toHaveText('Showing 1–1 of 1');
  });

  test('a member in good standing can borrow an available book', async ({ page }) => {
    await page.getByTestId('catalog-search-input').fill('Clean Code');
    await page.getByTestId('catalog-search-button').click();

    const row = page.getByTestId('catalog-result-item');
    await row.getByTestId('catalog-borrow-input').fill('LIB-1001');
    await row.getByTestId('catalog-borrow-button').click();

    await expect(row.getByTestId('catalog-borrow-result')).toHaveText(
      'Borrowed by Dana Whitfield.',
    );
    await expect(row.getByTestId('catalog-result-status')).toContainText('On loan · due');
    // The borrow form disappears once the book is no longer available.
    await expect(row.getByTestId('catalog-borrow-input')).toHaveCount(0);
  });

  test('a member not in good standing cannot borrow', async ({ page }) => {
    await page.getByTestId('catalog-search-input').fill('Clean Code');
    await page.getByTestId('catalog-search-button').click();

    const row = page.getByTestId('catalog-result-item');
    await row.getByTestId('catalog-borrow-input').fill('LIB-1004');
    await row.getByTestId('catalog-borrow-button').click();

    await expect(row.getByTestId('catalog-borrow-result')).toContainText('Not eligible');
    await expect(row.getByTestId('catalog-result-status')).toHaveText('Available');
  });

  test('an unknown member ID shows a not-found message when borrowing', async ({ page }) => {
    await page.getByTestId('catalog-search-input').fill('Clean Code');
    await page.getByTestId('catalog-search-button').click();

    const row = page.getByTestId('catalog-result-item');
    await row.getByTestId('catalog-borrow-input').fill('LIB-9999');
    await row.getByTestId('catalog-borrow-button').click();

    await expect(row.getByTestId('catalog-borrow-result')).toHaveText(
      'No member was found for that ID.',
    );
  });

  test('a book that is already on loan or on hold has no borrow form', async ({ page }) => {
    await page.getByTestId('catalog-search-input').fill('Design Patterns');
    await page.getByTestId('catalog-search-button').click();

    const row = page.getByTestId('catalog-result-item').filter({ hasText: 'Design Patterns' });
    await expect(row.getByTestId('catalog-borrow-input')).toHaveCount(0);
  });
});

test.describe('circulation desk', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/circulation');
  });

  test('initial state shows the lookup form and no result region', async ({ page }) => {
    await expect(page.getByTestId('member-id-input')).toBeVisible();
    await expect(page.getByTestId('member-result')).toHaveCount(0);
    await expect(page.getByTestId('member-not-found')).toHaveCount(0);
  });

  test('lists every member with their standing', async ({ page }) => {
    await expect(page.getByTestId('member-directory-row')).toHaveCount(8);

    const danaRow = page.getByTestId('member-directory-row').filter({ hasText: 'LIB-1001' });
    await expect(danaRow.getByTestId('member-directory-standing')).toHaveText('Eligible');

    const ravRow = page.getByTestId('member-directory-row').filter({ hasText: 'LIB-1002' });
    await expect(ravRow.getByTestId('member-directory-standing')).toContainText('fines');
  });

  test('a member in good standing is eligible to borrow', async ({ page }) => {
    await page.getByTestId('member-id-input').fill('LIB-1001');
    await page.getByTestId('member-lookup-button').click();

    await expect(page.getByTestId('member-result')).toBeVisible();
    await expect(page.getByTestId('member-name')).toHaveText('Dana Whitfield');
    await expect(page.getByTestId('member-eligibility')).toHaveText('Eligible to borrow.');
  });

  test('a member over the fine limit is blocked', async ({ page }) => {
    await page.getByTestId('member-id-input').fill('LIB-1002');
    await page.getByTestId('member-lookup-button').click();

    await expect(page.getByTestId('member-fines-owed')).toHaveText('$12.50');
    await expect(page.getByTestId('member-eligibility')).toContainText('Not eligible');
    await expect(page.getByTestId('member-eligibility')).toContainText('fines');
  });

  test('a member at the loan cap is blocked', async ({ page }) => {
    await page.getByTestId('member-id-input').fill('LIB-1003');
    await page.getByTestId('member-lookup-button').click();

    await expect(page.getByTestId('member-eligibility')).toContainText('loan limit');
  });

  test('a suspended member is blocked', async ({ page }) => {
    await page.getByTestId('member-id-input').fill('LIB-1004');
    await page.getByTestId('member-lookup-button').click();

    await expect(page.getByTestId('member-eligibility')).toContainText('suspended');
  });

  test('a second good-standing member added later is also eligible', async ({ page }) => {
    await page.getByTestId('member-id-input').fill('LIB-1006');
    await page.getByTestId('member-lookup-button').click();

    await expect(page.getByTestId('member-eligibility')).toHaveText('Eligible to borrow.');
  });

  test('an unknown member ID shows the not-found notice', async ({ page }) => {
    await page.getByTestId('member-id-input').fill('LIB-9999');
    await page.getByTestId('member-lookup-button').click();

    await expect(page.getByTestId('member-not-found')).toBeVisible();
    await expect(page.getByTestId('member-result')).toHaveCount(0);
  });
});

test.describe('hours & locations', () => {
  test('lists all three branches', async ({ page }) => {
    await page.goto('/hours');

    await expect(page.getByTestId('hours-branch-card')).toHaveCount(3);
    await expect(page.getByTestId('hours-branch-name').first()).toHaveText('Main Branch');
  });
});

test.describe('events', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/events');
  });

  test('lists every seeded event by default', async ({ page }) => {
    await expect(page.getByTestId('event-item')).toHaveCount(13);
  });

  test('filtering by a date with two events shows just those two', async ({ page }) => {
    await page.getByTestId('event-date-filter-input').fill('2026-09-17');

    await expect(page.getByTestId('event-item')).toHaveCount(2);
    await expect(page.getByTestId('event-title')).toContainText([
      'Book Club: Contemporary Fiction',
      'Family Craft Hour',
    ]);
  });

  test('filtering by a date with no events shows the no-results notice', async ({ page }) => {
    await page.getByTestId('event-date-filter-input').fill('2030-01-01');

    await expect(page.getByTestId('events-no-results')).toBeVisible();
    await expect(page.getByTestId('event-item')).toHaveCount(0);
  });

  test('clearing the date filter restores the full list', async ({ page }) => {
    await page.getByTestId('event-date-filter-input').fill('2026-09-17');
    await page.getByTestId('event-date-filter-clear').click();

    await expect(page.getByTestId('event-item')).toHaveCount(13);
  });

  test('a member in good standing can register for an event', async ({ page }) => {
    const firstEvent = page.getByTestId('event-item').first();

    await firstEvent.getByTestId('event-register-input').fill('LIB-1001');
    await firstEvent.getByTestId('event-register-button').click();

    await expect(firstEvent.getByTestId('event-register-result')).toHaveText(
      'Dana Whitfield is registered.',
    );
    await expect(firstEvent.getByTestId('event-registered-name')).toHaveText(
      'Registered: Dana Whitfield',
    );
  });

  test('a member not in good standing cannot register', async ({ page }) => {
    const firstEvent = page.getByTestId('event-item').first();

    await firstEvent.getByTestId('event-register-input').fill('LIB-1004');
    await firstEvent.getByTestId('event-register-button').click();

    await expect(firstEvent.getByTestId('event-register-result')).toContainText('Not eligible');
    await expect(firstEvent.getByTestId('event-registered-name')).toHaveCount(0);
  });

  test('an unknown member ID shows a not-found message', async ({ page }) => {
    const firstEvent = page.getByTestId('event-item').first();

    await firstEvent.getByTestId('event-register-input').fill('LIB-9999');
    await firstEvent.getByTestId('event-register-button').click();

    await expect(firstEvent.getByTestId('event-register-result')).toHaveText(
      'No member was found for that ID.',
    );
  });

  test('registering the same member twice is rejected the second time', async ({ page }) => {
    const firstEvent = page.getByTestId('event-item').first();

    await firstEvent.getByTestId('event-register-input').fill('LIB-1001');
    await firstEvent.getByTestId('event-register-button').click();
    await firstEvent.getByTestId('event-register-input').fill('LIB-1001');
    await firstEvent.getByTestId('event-register-button').click();

    await expect(firstEvent.getByTestId('event-register-result')).toHaveText(
      'That member is already registered for this event.',
    );
    await expect(firstEvent.getByTestId('event-registered-name')).toHaveCount(1);
  });
});
