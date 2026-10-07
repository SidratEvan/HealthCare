/**
 * A hospital reads what became of its month's SMS (`PRD.md` `FR-NOT-06`; plan
 * H2; `APP_FLOW.md` `S-B-11` `TXT-B11-SMS`).
 *
 * Under the cap its administrator sets, on the settings screen: how many
 * went, how many reached a phone, how many failed, how many were held back
 * and how many are still to go. The receipts, the signature and who may read
 * the figures are held by `smsDelivery.test.ts`; this is the screen.
 *
 * At Shapla, which the seed gives a week of confirmations. The demonstration's
 * SMS provider reports no delivery, and what the screen must not do with that
 * is show nought.
 */

import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';

import { E2E_DATABASE_URL, assertLocalDatabase } from './support/database.js';

const CONSOLE = 'http://localhost:3100';

let shapla: string;

test.beforeAll(async () => {
  assertLocalDatabase();
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const hospital = await client.query<{ id: string }>(
      `SELECT id FROM hospitals WHERE code = 'SHAPLA'`,
    );
    shapla = hospital.rows[0]?.id ?? '';
  } finally {
    await client.end();
  }
  if (shapla === '') throw new Error('The seed should hold Shapla.');
});

async function openSettings(page: Page): Promise<void> {
  await page.goto(CONSOLE);
  await expect(page.getByTestId('console-picker')).toBeVisible({ timeout: 45_000 });
  await page.getByTestId(`pick-hospital-${shapla}`).click();
  await page.getByTestId(`open-admin-${shapla}`).click();
  await expect(page.getByTestId('admin-section-today')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('admin-open-settings').click();
  await expect(page.getByTestId('hospital-settings')).toBeVisible({ timeout: 30_000 });
}

test.describe('this month’s SMS, on the hospital’s settings (FR-NOT-06)', () => {
  test.setTimeout(120_000);

  test('the month by what became of it, and no nought where delivery is not reported', async ({
    page,
  }) => {
    await openSettings(page);
    const month = page.getByTestId('settings-sms-month');
    await expect(month).toBeVisible();

    // The seed's week of confirmations: some went.
    await expect(page.getByTestId('settings-sms-sent')).toHaveText(/[১-৯]/);
    await expect(page.getByTestId('settings-sms-failed')).toHaveText(/^[০-৯,]+$/);
    await expect(page.getByTestId('settings-sms-held')).toHaveText(/^[০-৯,]+$/);
    await expect(page.getByTestId('settings-sms-waiting')).toHaveText(/^[০-৯,]+$/);

    // The demonstration's provider sends no receipts. Not "০": a sentence.
    const delivered = page.getByTestId('settings-sms-delivered');
    await expect(delivered).toHaveAttribute('data-known', 'false');
    await expect(delivered).toHaveText('এই এসএমএস সেবা পৌঁছানোর খবর দেয় না');

    // A live figure says how old it is.
    await expect(month.getByTestId('freshness')).toBeVisible();
  });

  test('with a cap set, what was sent is read against it', async ({ page }) => {
    await openSettings(page);
    const rules = page.getByTestId('settings-rules');
    const cap = rules.getByLabel('মাসে সর্বোচ্চ এসএমএস');

    try {
      // No cap in the seed: a plain count.
      await expect(page.getByTestId('settings-sms-sent')).not.toContainText('এর মধ্যে');

      await cap.fill('5000');
      await page.getByTestId('settings-save-rules').click();
      await expect(page.getByTestId('settings-sms-sent')).toContainText('৫,০০০-এর মধ্যে', {
        timeout: 15_000,
      });
    } finally {
      // As the seed leaves it: no cap.
      await cap.fill('');
      await page.getByTestId('settings-save-rules').click();
      await expect(page.getByTestId('settings-sms-sent')).not.toContainText('এর মধ্যে', {
        timeout: 15_000,
      });
    }
  });
});
