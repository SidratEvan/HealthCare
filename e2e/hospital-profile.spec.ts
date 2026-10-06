/**
 * A hospital's public face is its own to set (`PRD.md` `FR-BRD-06`; plan C1;
 * `APP_FLOW.md` B6 `FRM-B11-DESCRIPTION`, `FRM-B11-LOGO`, `FRM-B11-BRAND`).
 *
 * The whole of it, through two screens: an administrator writes what the
 * hospital says of itself, picks its colour and uploads its logo on `S-B-11`;
 * the patient app, opened for that hospital, is then in that colour with that
 * logo in its header, and the hospital's card and page in the network carry
 * the logo and the words. Then the administrator takes it all back, and the
 * app is the platform's again.
 *
 * At Karnaphuli, which the seed gives no colours and no logo, so that Padma's
 * (which `hospital-scope.spec.ts` stands on) are never touched. The seeded
 * description is put back at the end, by the screen and, whatever happened,
 * by the database afterwards.
 */

import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';

import { E2E_DATABASE_URL, assertLocalDatabase } from './support/database.js';
import { bengali } from './support/digits.js';

const CONSOLE = 'http://localhost:3100';
const PATIENT = 'http://localhost:3000';
const API = 'http://localhost:4000/api/v1';

const CODE = 'KARNAPHULI';
const PLATFORM_BRAND = '#0c5c46';
/** A logo's yellow: it cannot carry white text as it is, so it is darkened. */
const CHOSEN = '#ffd400';

const WORDS_BN = 'চট্টগ্রামের একটি হাসপাতাল, পরীক্ষার জন্য লেখা বর্ণনা। (ডেমো)';
const WORDS_EN = 'A hospital in Chattogram, described for a test. (Demo)';

/** A one-pixel PNG: a real image, so the browser draws it. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

interface Seeded {
  readonly id: string;
  readonly descriptionBn: string | null;
  readonly descriptionEn: string | null;
}

let seeded: Seeded;

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

test.beforeAll(async () => {
  seeded = await withClient(async (client) => {
    const result = await client.query<{
      id: string;
      description_bn: string | null;
      description_en: string | null;
    }>('SELECT id, description_bn, description_en FROM hospitals WHERE code = $1', [CODE]);
    const row = result.rows[0];
    if (row === undefined) throw new Error(`The seed should hold ${CODE} (FR-DEM-01).`);
    return { id: row.id, descriptionBn: row.description_bn, descriptionEn: row.description_en };
  });
});

// Whatever the test did or did not reach: Karnaphuli is as the seed left it,
// so that no other spec meets a hospital in somebody's test colours.
test.afterAll(async () => {
  await withClient(async (client) => {
    await client.query('UPDATE hospital_settings SET brand = NULL WHERE hospital_id = $1', [
      seeded.id,
    ]);
    await client.query('DELETE FROM hospital_logos WHERE hospital_id = $1', [seeded.id]);
    await client.query(
      'UPDATE hospitals SET description_bn = $2, description_en = $3 WHERE id = $1',
      [seeded.id, seeded.descriptionBn, seeded.descriptionEn],
    );
  });
});

async function openSettings(page: Page): Promise<void> {
  await page.goto(CONSOLE);
  await expect(page.getByTestId('console-picker')).toBeVisible({ timeout: 45_000 });
  await page.getByTestId(`pick-hospital-${seeded.id}`).click();
  await page.getByTestId(`open-admin-${seeded.id}`).click();
  await expect(page.getByTestId('admin-section-today')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('admin-open-settings').click();
  await expect(page.getByTestId('hospital-settings')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('settings-face')).toBeVisible();
}

async function brand600(page: Page): Promise<string> {
  return await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--brand-600').trim(),
  );
}

/** Whether the logo in the header is an image the browser actually drew. */
async function drawn(page: Page): Promise<boolean> {
  return await page
    .locator('header [data-testid="facility-mark"]')
    .evaluate((node) => node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0);
}

test.describe('a hospital sets what patients see of it (FR-BRD-06)', () => {
  test.setTimeout(180_000);

  test('its words, its colour and its logo reach the patient app, and can be taken back', async ({
    page,
    context,
  }) => {
    await openSettings(page);

    // Where its portal is (`FR-BRD-07`): its code under the platform's domain,
    // which on this machine is `localhost` (`playwright.config.ts`).
    await expect(page.getByTestId('settings-portal-address')).toHaveText(
      'http://karnaphuli.localhost:3000',
    );

    // --- as the seed left it: no logo, the platform's colours ----------------
    await expect(page.getByTestId('settings-logo-preview')).toHaveAttribute(
      'data-has-logo',
      'false',
    );
    await expect(page.getByTestId('settings-brand-reset')).toHaveCount(0);
    await expect(page.getByTestId('settings-logo-remove')).toHaveCount(0);

    // --- what it says of itself ----------------------------------------------
    await page.getByTestId('settings-description-bn').fill(WORDS_BN);
    await page.getByTestId('settings-description-en').fill(WORDS_EN);
    // Counted as it is typed, in the screen's own digits (`TYP-04`).
    await expect(page.getByTestId('settings-description-en-count')).toContainText(
      `${bengali(WORDS_EN.length)}/${bengali(400)}`,
    );
    await page.getByTestId('settings-save-description').click();
    await expect(page.getByText('সংরক্ষণ করা হয়েছে').first()).toBeVisible();

    // Too long is said before it is sent, and cannot be saved.
    await page.getByTestId('settings-description-en').fill('x'.repeat(401));
    await expect(page.getByTestId('settings-save-description')).toBeDisabled();
    await page.getByTestId('settings-description-en').fill(WORDS_EN);
    await expect(page.getByTestId('settings-save-description')).toBeEnabled();

    // --- its colour: one chosen, darkened only as far as it must be -----------
    await page.getByTestId('settings-brand-colour').fill(CHOSEN);
    await expect(page.getByTestId('settings-brand-darkened')).toBeVisible();
    const main = (await page.getByTestId('settings-brand-preview').getAttribute('data-main')) ?? '';
    expect(main).toMatch(/^#[0-9a-f]{6}$/);
    expect(main).not.toBe(CHOSEN);
    // The preview is the app's own tokens, re-scoped: the sample button is in
    // the colour that will be saved.
    await expect
      .poll(
        async () =>
          await page
            .getByTestId('settings-brand-preview')
            .evaluate((node) => getComputedStyle(node).getPropertyValue('--brand-600').trim()),
      )
      .toBe(main);
    await page.getByTestId('settings-brand-save').click();
    await expect(page.getByTestId('settings-brand-reset')).toBeVisible();
    // Saved is saved: the same colour again is nothing to save.
    await expect(page.getByTestId('settings-brand-save')).toBeDisabled();

    // --- its logo -------------------------------------------------------------
    // Not an image: refused here, with why, and nothing to save.
    await page.getByTestId('settings-logo-file').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not a logo'),
    });
    await expect(page.getByTestId('settings-logo-refused')).toBeVisible();
    await expect(page.getByTestId('settings-logo-save')).toBeDisabled();

    await page.getByTestId('settings-logo-file').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: PIXEL,
    });
    await expect(page.getByTestId('settings-logo-refused')).toHaveCount(0);
    await page.getByTestId('settings-logo-save').click();
    await expect(page.getByTestId('settings-logo-remove')).toBeVisible();
    await expect(page.getByTestId('settings-logo-preview')).toHaveAttribute(
      'data-has-logo',
      'true',
    );

    // --- the patient app, opened for this hospital ------------------------------
    const phone = await context.newPage();
    await phone.goto(`${PATIENT}/?scope=${CODE}`);
    await expect(phone.locator('html')).toHaveAttribute('data-scope', CODE);
    await expect.poll(async () => await brand600(phone)).toBe(main);
    await expect(phone.locator('header [data-testid="facility-mark"]')).toHaveAttribute(
      'data-logo',
      'true',
    );
    await expect.poll(async () => await drawn(phone)).toBe(true);

    // Its own page says what it says of itself.
    await phone.goto(`${PATIENT}/book?hospital=${seeded.id}&scope=${CODE}`);
    await expect(phone.getByTestId('facility-description')).toHaveText(WORDS_BN);

    // --- and in the network's own app, on its card -----------------------------
    const published = await fetch(`${API}/hospitals/${seeded.id}`);
    const card = (
      (await published.json()) as {
        data: { hospital: { descriptionEn: string | null; logoVersion: string | null } };
      }
    ).data.hospital;
    expect(card.descriptionEn).toBe(WORDS_EN);
    expect(card.logoVersion).toMatch(/^[0-9a-f]{16}$/);
    const logo = await fetch(`${API}/hospitals/${seeded.id}/logo?v=${card.logoVersion ?? ''}`);
    expect(logo.status).toBe(200);
    expect(logo.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await logo.arrayBuffer()).equals(PIXEL)).toBe(true);
    await phone.close();

    // --- taken back, from the same screen ---------------------------------------
    await page.getByTestId('settings-brand-reset').click();
    await expect(page.getByTestId('settings-brand-reset')).toHaveCount(0);
    await page.getByTestId('settings-logo-remove').click();
    await expect(page.getByTestId('settings-logo-remove')).toHaveCount(0);
    await expect(page.getByTestId('settings-logo-preview')).toHaveAttribute(
      'data-has-logo',
      'false',
    );
    await page.getByTestId('settings-description-bn').fill(seeded.descriptionBn ?? '');
    await page.getByTestId('settings-description-en').fill(seeded.descriptionEn ?? '');
    await page.getByTestId('settings-save-description').click();
    await expect
      .poll(async () => {
        const again = await fetch(`${API}/hospitals/${seeded.id}`);
        const body = (await again.json()) as {
          data: { hospital: { descriptionEn: string | null; logoVersion: string | null } };
        };
        return body.data.hospital;
      })
      .toMatchObject({ descriptionEn: seeded.descriptionEn, logoVersion: null });

    const after = await context.newPage();
    await after.goto(`${PATIENT}/?scope=${CODE}`);
    await expect(after.locator('html')).toHaveAttribute('data-scope', CODE);
    await expect.poll(async () => await brand600(after)).toBe(PLATFORM_BRAND);
    await expect(after.locator('header [data-testid="facility-mark"]')).toHaveCount(0);
    await after.close();
  });
});

test('Padma, which the seed gives a logo, shows it in its own app', async ({ page }) => {
  await page.goto(`${PATIENT}/?scope=PADMA`);
  await expect(page.locator('html')).toHaveAttribute('data-scope', 'PADMA');
  await expect(page.locator('header [data-testid="facility-mark"]')).toHaveAttribute(
    'data-logo',
    'true',
  );
  await expect.poll(async () => await drawn(page)).toBe(true);
});

// A page of its own: a hospital's app stays that hospital's on the next
// screen (`hospital-scope.spec.ts`), so the network is asked from a phone
// that was never in one.
test('in the network, each card carries its own mark: a logo, or the plain one', async ({
  page,
}) => {
  await page.goto(`${PATIENT}/search`);
  const results = page.getByTestId('search-results');
  await expect(results).toBeVisible();
  const padma = results.locator('[data-testid^="result-hospital-"]', { hasText: 'পদ্মা' });
  await expect(padma.getByTestId('facility-mark')).toHaveAttribute('data-logo', 'true');
  // One that has set none says so with the hospital icon, never a broken image.
  const shapla = results.locator('[data-testid^="result-hospital-"]', { hasText: 'শাপলা' });
  await expect(shapla.getByTestId('facility-mark')).toHaveAttribute('data-logo', 'false');
});
