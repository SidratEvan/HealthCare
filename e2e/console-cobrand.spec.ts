/**
 * The staff workspace is the hospital's own (plan K4; `PRD.md` `FR-BRD-12`;
 * `APP_FLOW.md` B1.1).
 *
 * Padma, which the seed gives a mark and colours (`FR-BRD-06`), shows its logo
 * and wears its colours on the console, with Powered by MedLiveBD beneath its
 * name. Karnaphuli, which the seed gives neither, shows its name on the
 * platform's colour, and the same line beneath. Read-only: nothing is changed.
 */

import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';

import { adminToken } from './support/console.js';
import { E2E_DATABASE_URL, assertLocalDatabase } from './support/database.js';

const CONSOLE = 'http://localhost:3100';

async function hospitalId(code: string): Promise<string> {
  assertLocalDatabase();
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query<{ id: string }>(
      'SELECT id FROM hospitals WHERE code = $1 AND deleted_at IS NULL',
      [code],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) throw new Error(`the seed should hold ${code}`);
    return id;
  } finally {
    await client.end();
  }
}

async function openAdminConsole(page: Page, code: string): Promise<void> {
  const id = await hospitalId(code);
  const token = await adminToken(id);
  await page.addInitScript(
    ([value, hospital]) => {
      sessionStorage.setItem(
        'console.demo-session',
        JSON.stringify({
          token: value,
          hospitalId: hospital,
          staffName: 'Admin (Demo)',
          role: 'hospital_admin',
        }),
      );
    },
    [token, id],
  );
  await page.goto(`${CONSOLE}/?view=admin`);
  await expect(page.getByTestId('admin-dashboard')).toBeVisible();
}

test('a hospital with a mark and colours wears them, powered by MedLiveBD (FR-BRD-12)', async ({
  page,
}) => {
  await openAdminConsole(page, 'PADMA');
  const rail = page.getByTestId('brand-mark');

  await expect(rail.getByTestId('brand-logo')).toBeVisible();
  await expect(rail.getByTestId('brand-name')).toContainText('পদ্মা');
  await expect(rail.getByTestId('brand-powered-by')).toHaveText('Powered by MedLiveBD');
  await expect(rail).toHaveAttribute('data-brand', 'hospital');

  // The colours are on the document, as a portal's are on the patient app.
  const primary = await page.evaluate(() =>
    document.documentElement.style.getPropertyValue('--brand-600'),
  );
  expect(primary).toMatch(/^#[0-9a-f]{6}$/i);
});

test('a hospital with neither shows its name on the platform’s colour, and the same line', async ({
  page,
}) => {
  await openAdminConsole(page, 'KARNAPHULI');
  const rail = page.getByTestId('brand-mark');

  await expect(rail.getByTestId('brand-powered-by')).toHaveText('Powered by MedLiveBD');
  await expect(rail.getByTestId('brand-logo')).toHaveCount(0);
  await expect(rail).toHaveAttribute('data-brand', 'platform');
  const primary = await page.evaluate(() =>
    document.documentElement.style.getPropertyValue('--brand-600'),
  );
  expect(primary).toBe('');
});
