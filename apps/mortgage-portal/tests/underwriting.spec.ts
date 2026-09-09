import { expect, test } from '@playwright/test';

/**
 * The portal's own tests, pinning what a recorded workflow depends on.
 *
 * Two kinds of assertion here, and the second is the load-bearing one. The
 * first checks the portal works as a portal. The second pins the *branch
 * matrix*: each file's figures put it on a different side of a different
 * underwriting rule, and a workflow recorded against this portal is only worth
 * running against several files if the files actually differ. If someone edits
 * a loan's numbers and the matrix collapses, these fail here rather than
 * silently turning a multi-branch demonstration into one path run eight times.
 */

test.describe('pipeline', () => {
  test('lists every file awaiting a decision', async ({ page }) => {
    await page.goto('/pipeline');
    await expect(page.getByTestId('pipeline-table').locator('tbody tr')).toHaveCount(8);
  });

  test('opens a file by loan number', async ({ page }) => {
    await page.goto('/pipeline');
    await page.getByTestId('loan-number-input').fill('ML-26-04471');
    await page.getByTestId('open-loan-button').click();

    await expect(page.getByTestId('loan-number')).toHaveText('ML-26-04471');
    await expect(page.getByTestId('borrower-name')).toHaveText('Dana Okonkwo');
  });

  test('reports an unknown loan number rather than opening nothing', async ({ page }) => {
    await page.goto('/pipeline');
    await page.getByTestId('loan-number-input').fill('ML-26-99999');
    await page.getByTestId('open-loan-button').click();

    await expect(page.getByTestId('loan-not-found')).toBeVisible();
  });
});

test.describe('the underwriting summary', () => {
  test('shows every figure a rule is written against', async ({ page }) => {
    await page.goto('/underwriting?loan=ML-26-04471');

    await expect(page.getByTestId('ltv-value')).toHaveText('72.73%');
    await expect(page.getByTestId('dti-value')).toHaveText('28.00%');
    await expect(page.getByTestId('credit-score-value')).toHaveText('762');
    await expect(page.getByTestId('flood-zone-value')).toHaveText('X');
    await expect(page.getByTestId('employment-type-value')).toHaveText('W-2 employee');
    await expect(page.getByTestId('conforming-limit-value')).toHaveText('$806,500');
  });

  test('computes loan-to-value against the lesser of price and appraised value', async ({
    page,
  }) => {
    // ML-26-04488 appraised low: 430,000 against a 432,000 price. The lower
    // figure is the basis, which is what pushes this file over 80%.
    await page.goto('/underwriting?loan=ML-26-04488');
    await expect(page.getByTestId('ltv-value')).toHaveText('92.09%');
  });
});

test.describe('conditions and decisions', () => {
  test('attaches a condition, and will not attach the same one twice', async ({ page }) => {
    await page.goto('/underwriting?loan=ML-26-04488');
    await expect(page.getByTestId('conditions-empty')).toBeVisible();

    await page.getByTestId('add-pmi-condition').click();

    await expect(page.getByTestId('condition-pmi')).toBeVisible();
    await expect(page.getByTestId('add-pmi-condition')).toBeDisabled();
  });

  test('approving with a condition attached reads as conditionally approved', async ({ page }) => {
    await page.goto('/underwriting?loan=ML-26-04488');
    await page.getByTestId('add-pmi-condition').click();
    await page.getByTestId('approve-button').click();

    await expect(page.getByTestId('decision-status')).toHaveText('Conditionally approved');
  });

  test('approving a clean file reads as approved outright', async ({ page }) => {
    await page.goto('/underwriting?loan=ML-26-04471');
    await page.getByTestId('approve-button').click();

    await expect(page.getByTestId('decision-status')).toHaveText('Approved');
  });

  test('a file can be referred to a senior underwriter', async ({ page }) => {
    await page.goto('/underwriting?loan=ML-26-04529');
    await page.getByTestId('escalate-button').click();

    await expect(page.getByTestId('decision-status')).toHaveText('Referred to senior underwriter');
  });

  test('a file can be declined', async ({ page }) => {
    await page.goto('/underwriting?loan=ML-26-04547');
    await page.getByTestId('decline-button').click();

    await expect(page.getByTestId('decision-status')).toHaveText('Declined');
  });
});

test.describe('the branch matrix', () => {
  /**
   * Each row is a file and the side of each threshold it sits on. A workflow
   * recorded once and run against all of these takes a different path each
   * time, which is the entire reason this portal has eight files rather than
   * one.
   */
  const MATRIX = [
    { loan: 'ML-26-04471', ltvOver80: false, dtiOver43: false, ficoUnder620: false, flood: 'X' },
    { loan: 'ML-26-04488', ltvOver80: true, dtiOver43: false, ficoUnder620: false, flood: 'X' },
    { loan: 'ML-26-04502', ltvOver80: false, dtiOver43: false, ficoUnder620: false, flood: 'X' },
    { loan: 'ML-26-04513', ltvOver80: false, dtiOver43: false, ficoUnder620: false, flood: 'AE' },
    { loan: 'ML-26-04529', ltvOver80: true, dtiOver43: true, ficoUnder620: false, flood: 'X' },
    { loan: 'ML-26-04534', ltvOver80: false, dtiOver43: false, ficoUnder620: false, flood: 'X' },
    { loan: 'ML-26-04547', ltvOver80: true, dtiOver43: false, ficoUnder620: true, flood: 'X' },
    { loan: 'ML-26-04561', ltvOver80: true, dtiOver43: false, ficoUnder620: false, flood: 'VE' },
  ] as const;

  for (const row of MATRIX) {
    test(`${row.loan} sits where the matrix says it does`, async ({ page }) => {
      await page.goto(`/underwriting?loan=${row.loan}`);

      const ltv = Number((await page.getByTestId('ltv-value').innerText()).replace('%', ''));
      const dti = Number((await page.getByTestId('dti-value').innerText()).replace('%', ''));
      const fico = Number(await page.getByTestId('credit-score-value').innerText());

      expect(ltv > 80, `LTV ${String(ltv)}`).toBe(row.ltvOver80);
      expect(dti > 43, `DTI ${String(dti)}`).toBe(row.dtiOver43);
      expect(fico < 620, `FICO ${String(fico)}`).toBe(row.ficoUnder620);
      await expect(page.getByTestId('flood-zone-value')).toHaveText(row.flood);
    });
  }

  test('the matrix covers both sides of every threshold', () => {
    // A matrix where every file agrees on a rule proves nothing about that
    // rule, so this asserts the coverage rather than trusting the rows above.
    for (const key of ['ltvOver80', 'dtiOver43', 'ficoUnder620'] as const) {
      const values = new Set(MATRIX.map((row) => row[key]));
      expect(values, `${key} needs a file on each side`).toEqual(new Set([true, false]));
    }

    expect(new Set(MATRIX.map((row) => row.flood))).toEqual(new Set(['X', 'AE', 'VE']));
  });
});
