import { expect, test } from '@playwright/test';

const FOUND_REQUEST = 'SR-1001';
const UNKNOWN_REQUEST = 'SR-9999';

test.beforeEach(async ({ page }) => {
  await page.goto('/requests');
});

test('initial state shows the search form and neither result region', async ({ page }) => {
  await expect(page.getByTestId('request-number-input')).toBeVisible();
  await expect(page.getByTestId('search-request-button')).toBeVisible();

  await expect(page.getByTestId('request-result')).toHaveCount(0);
  await expect(page.getByTestId('request-not-found')).toHaveCount(0);
});

test('the request number input is reachable by its accessible name', async ({ page }) => {
  await expect(page.getByLabel('Service request number')).toBeVisible();
});

test('found path shows the seeded request and no not-found region', async ({ page }) => {
  await page.getByTestId('request-number-input').fill(FOUND_REQUEST);
  await page.getByTestId('search-request-button').click();

  await expect(page.getByTestId('request-result')).toBeVisible();
  await expect(page.getByTestId('request-number-result')).toHaveText(FOUND_REQUEST);
  await expect(page.getByTestId('request-status')).toHaveText('In Progress');
  await expect(page.getByTestId('assigned-team')).toHaveText('Infrastructure Operations');

  await expect(page.getByTestId('request-not-found')).toHaveCount(0);
});

test('not-found path shows the controlled notice and no result region', async ({ page }) => {
  await page.getByTestId('request-number-input').fill(UNKNOWN_REQUEST);
  await page.getByTestId('search-request-button').click();

  await expect(page.getByTestId('request-not-found')).toBeVisible();
  await expect(page.getByTestId('request-result')).toHaveCount(0);
});

test('result and not-found never appear together across transitions', async ({ page }) => {
  const input = page.getByTestId('request-number-input');
  const searchButton = page.getByTestId('search-request-button');

  const transitions = [
    { value: FOUND_REQUEST, shown: 'request-result', hidden: 'request-not-found' },
    { value: UNKNOWN_REQUEST, shown: 'request-not-found', hidden: 'request-result' },
    { value: FOUND_REQUEST, shown: 'request-result', hidden: 'request-not-found' },
  ] as const;

  for (const { value, shown, hidden } of transitions) {
    await input.fill(value);
    await searchButton.click();

    await expect(page.getByTestId(shown)).toBeVisible();
    await expect(page.getByTestId(hidden)).toHaveCount(0);
  }
});

test('submitting with the Enter key performs the search', async ({ page }) => {
  await page.getByTestId('request-number-input').fill(FOUND_REQUEST);
  await page.getByTestId('request-number-input').press('Enter');

  await expect(page.getByTestId('request-result')).toBeVisible();
  await expect(page.getByTestId('request-number-result')).toHaveText(FOUND_REQUEST);
});

test('surrounding whitespace is trimmed before lookup', async ({ page }) => {
  await page.getByTestId('request-number-input').fill(`  ${FOUND_REQUEST}  `);
  await page.getByTestId('search-request-button').click();

  await expect(page.getByTestId('request-result')).toBeVisible();
  await expect(page.getByTestId('request-number-result')).toHaveText(FOUND_REQUEST);
});

test('lookup is case-sensitive, so a lowercase request number is not found', async ({ page }) => {
  await page.getByTestId('request-number-input').fill('sr-1001');
  await page.getByTestId('search-request-button').click();

  await expect(page.getByTestId('request-not-found')).toBeVisible();
  await expect(page.getByTestId('request-result')).toHaveCount(0);
});

test('blank input stays in the initial state', async ({ page }) => {
  await page.getByTestId('search-request-button').click();

  await expect(page.getByTestId('request-result')).toHaveCount(0);
  await expect(page.getByTestId('request-not-found')).toHaveCount(0);
});
