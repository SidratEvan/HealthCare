/**
 * A hospital decides which live figures it shares (`PRD.md` `FR-NET-04`;
 * plan C5; `APP_FLOW.md` B6 `FRM-B11-PUBLISHING`).
 *
 * The administrator turns a figure off on the settings screen; the patient
 * app then says that figure is not shared, in the place it would have been,
 * and never shows a zero for it. What the API answers is held by
 * `publishing.routes.test.ts`; this is the two screens.
 *
 * At Karnaphuli, which the seed leaves sharing everything, and put back that
 * way afterwards. The clinic the seed leaves keeping its serial figures
 * (Buriganga, `seed_01_hospitals`) is read and not changed.
 */

import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';

import { E2E_DATABASE_URL, assertLocalDatabase } from './support/database.js';

const CONSOLE = 'http://localhost:3100';
const PATIENT = 'http://localhost:3000';

let karnaphuli: string;
let buriganga: string;

async function withClient<T>(body: (client: Client) => Promise<T>): Promise<T> {
  assertLocalDatabase();
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return await body(client);
  } finally {
    await client.end();
  }
}

async function idOf(client: Client, code: string): Promise<string> {
  const result = await client.query<{ id: string }>('SELECT id FROM hospitals WHERE code = $1', [
    code,
  ]);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error(`The seed should hold ${code} (FR-DEM-01).`);
  return id;
}

test.beforeAll(async () => {
  await withClient(async (client) => {
    karnaphuli = await idOf(client, 'KARNAPHULI');
    buriganga = await idOf(client, 'BURIGANGA');
  });
});

// Whatever the test reached, Karnaphuli shares everything again: no other
// spec should meet a hospital that keeps a figure it expects to read.
test.afterAll(async () => {
  await withClient(async (client) => {
    await client.query(`UPDATE hospital_settings SET unpublished = '{}' WHERE hospital_id = $1`, [
      karnaphuli,
    ]);
  });
});

async function openSettings(page: Page, hospitalId: string): Promise<void> {
  await page.goto(CONSOLE);
  await expect(page.getByTestId('console-picker')).toBeVisible({ timeout: 45_000 });
  await page.getByTestId(`pick-hospital-${hospitalId}`).click();
  await page.getByTestId(`open-admin-${hospitalId}`).click();
  await expect(page.getByTestId('admin-section-today')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('admin-open-settings').click();
  await expect(page.getByTestId('hospital-settings')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('settings-publishing')).toBeVisible();
}

test.describe('a hospital chooses what the network is told (FR-NET-04)', () => {
  test.setTimeout(180_000);

  test('a figure switched off reads "not shared" in the patient app, and comes back when switched on', async ({
    page,
    context,
  }) => {
    await openSettings(page, karnaphuli);

    // As the seed leaves it: everything shared, and nothing to save.
    for (const figure of ['serials', 'beds', 'stock']) {
      await expect(page.getByTestId(`settings-publish-${figure}`)).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(page.getByTestId(`settings-publish-${figure}-state`)).toHaveText('দেখানো হচ্ছে');
    }
    await expect(page.getByTestId('settings-publishing-save')).toBeDisabled();

    // What the emergency department can treat is not among the switches.
    await expect(page.getByTestId('settings-publishing')).toContainText(
      'জরুরি বিভাগে কী চিকিৎসা হয় তা সব সময় দেখানো হয়',
    );

    // The patient app, before: a bed figure with its age, and chamber counts.
    const phone = await context.newPage();
    await phone.goto(`${PATIENT}/search`);
    const result = phone.getByTestId(`result-hospital-${karnaphuli}`);
    await expect(result).toBeVisible({ timeout: 45_000 });
    await expect(result.getByTestId('card-beds').getByTestId('freshness')).toBeVisible();
    await expect(result.getByTestId('beds-not-shared')).toHaveCount(0);
    await expect(result.getByTestId('serials-not-shared')).toHaveCount(0);

    // --- beds off -------------------------------------------------------------
    await page.getByTestId('settings-publish-beds').click();
    await expect(page.getByTestId('settings-publish-beds-state')).toHaveText('জানানো হচ্ছে না');
    await page.getByTestId('settings-publishing-save').click();
    await expect(page.getByText('সংরক্ষণ করা হয়েছে').first()).toBeVisible();
    await expect(page.getByTestId('settings-publish-beds')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(page.getByTestId('settings-publishing-save')).toBeDisabled();

    await phone.reload();
    await expect(result).toBeVisible({ timeout: 45_000 });
    await expect(result.getByTestId('beds-not-shared')).toHaveText('বেডের সংখ্যা জানানো হয়নি');
    // No count, no "none free", and no age under a figure that is not there.
    await expect(result.getByTestId('card-beds')).not.toContainText(/[০-৯]/);
    await expect(result.getByTestId('card-beds').getByTestId('freshness')).toHaveCount(0);
    // Its chambers are another decision: still shown, and not marked as
    // kept. Not a number: after the day's chambers end the honest line is
    // that nobody is sitting and no serial is open, which has none.
    await expect(result.getByTestId('serials-not-shared')).toHaveCount(0);
    await expect(result.getByTestId('result-chamber-line')).toBeVisible();
    await expect(result.getByTestId('result-chamber-line')).not.toContainText('জানানো হয়নি');

    // Asked for a ward bed: it is still among the hospitals that have one,
    // and its line says the count is kept.
    await phone.goto(`${PATIENT}/search?need=bed:general`);
    const asked = phone.getByTestId(`result-hospital-${karnaphuli}`);
    await expect(asked).toBeVisible({ timeout: 45_000 });
    await expect(
      asked.getByTestId('result-need-line').getByTestId('beds-not-shared'),
    ).toBeVisible();
    await expect(asked.getByTestId('result-need-line')).not.toContainText(/[০-৯]/);

    // And on the bed search itself: said, with a request still to send.
    await phone.goto(`${PATIENT}/beds?kind=general`);
    const bedCard = phone.getByTestId(`bed-card-${karnaphuli}`);
    await expect(bedCard).toBeVisible({ timeout: 45_000 });
    await expect(bedCard).toHaveAttribute('data-shared', 'false');
    await expect(bedCard.getByTestId('beds-not-shared')).toBeVisible();
    await expect(bedCard.getByTestId('bed-card-free')).toHaveCount(0);
    await expect(phone.getByTestId(`request-bed-${karnaphuli}`)).toBeEnabled();

    // --- serials off as well ----------------------------------------------------
    await page.getByTestId('settings-publish-serials').click();
    await page.getByTestId('settings-publishing-save').click();
    await expect(page.getByTestId('settings-publish-serials')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(page.getByTestId('settings-publishing-save')).toBeDisabled();

    await phone.goto(`${PATIENT}/search`);
    await expect(result).toBeVisible({ timeout: 45_000 });
    await expect(result.getByTestId('serials-not-shared')).toHaveText(
      'সিরিয়ালের সংখ্যা জানানো হয়নি',
    );
    await expect(result.getByTestId('result-chamber-line')).not.toContainText('বসছেন');

    // Its doctors are still listed and still bookable; each card says the
    // serial figures are kept, and none says a chamber is full or empty.
    await phone.goto(`${PATIENT}/book?hospital=${karnaphuli}`);
    const doctors = phone.locator('[data-testid^="doctor-"]');
    await expect(doctors.first()).toBeVisible({ timeout: 45_000 });
    const count = await doctors.count();
    expect(count).toBeGreaterThan(0);
    await expect(phone.getByTestId('serials-not-shared')).toHaveCount(count);

    // --- and back ----------------------------------------------------------------
    await page.getByTestId('settings-publish-beds').click();
    await page.getByTestId('settings-publish-serials').click();
    await page.getByTestId('settings-publishing-save').click();
    await expect(page.getByTestId('settings-publish-beds')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('settings-publishing-save')).toBeDisabled();

    await phone.goto(`${PATIENT}/search`);
    await expect(result).toBeVisible({ timeout: 45_000 });
    await expect(result.getByTestId('beds-not-shared')).toHaveCount(0);
    await expect(result.getByTestId('serials-not-shared')).toHaveCount(0);
    await expect(result.getByTestId('card-beds').getByTestId('freshness')).toBeVisible();
  });

  test('the demonstration has a clinic that keeps its serial figures, on both screens', async ({
    page,
    context,
  }) => {
    await openSettings(page, buriganga);
    await expect(page.getByTestId('settings-publish-serials')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(page.getByTestId('settings-publish-serials-state')).toHaveText('জানানো হচ্ছে না');
    // It runs no ward (`seed_01_hospitals`): there is no bed figure to switch.
    await expect(page.getByTestId('settings-publish-beds')).toHaveCount(0);
    await expect(page.getByTestId('settings-publish-stock')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const phone = await context.newPage();
    await phone.goto(`${PATIENT}/search`);
    const result = phone.getByTestId(`result-hospital-${buriganga}`);
    await expect(result).toBeVisible({ timeout: 45_000 });
    await expect(result.getByTestId('serials-not-shared')).toBeVisible();
    // Not running beds is said by saying nothing; it is not "not shared".
    await expect(result.getByTestId('beds-not-shared')).toHaveCount(0);
  });
});
