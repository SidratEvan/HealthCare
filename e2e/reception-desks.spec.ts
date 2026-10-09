/**
 * Reception desks in the picker (plan R4; `PRD.md` `FR-REC-32`; `APP_FLOW.md`
 * `SEL-B01-COUNTER`).
 *
 * At a hospital with desks, choosing one lists its doctors' chambers first and
 * every other chamber after them. Nothing is hidden: a desk organises and
 * never restricts (decision 2a). The seed gives Padma two desks.
 */

import { expect, test } from '@playwright/test';
import { Client } from 'pg';

import { E2E_DATABASE_URL, assertLocalDatabase } from './support/database.js';

const CONSOLE = 'http://localhost:3100';

async function padma(): Promise<{ hospitalId: string; deskId: string }> {
  assertLocalDatabase();
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query<{ hospital_id: string; desk_id: string }>(
      `SELECT d.hospital_id, d.id AS desk_id
         FROM reception_desks d JOIN hospitals h ON h.id = d.hospital_id
        WHERE h.name_en LIKE 'Padma%' AND d.deleted_at IS NULL
        ORDER BY d.name_en DESC LIMIT 1`,
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('the seed gives Padma its desks (FR-REC-32)');
    return { hospitalId: row.hospital_id, deskId: row.desk_id };
  } finally {
    await client.end();
  }
}

test('a desk puts its own chambers first and hides none (FR-REC-32)', async ({ page }) => {
  const { hospitalId, deskId } = await padma();

  await page.goto(CONSOLE);
  await expect(page.getByTestId('console-picker')).toBeVisible();
  await page.getByTestId(`pick-hospital-${hospitalId}`).click();

  const cards = page.locator('[data-testid^="chamber-card-"]');
  await expect(page.getByTestId('picker-desks')).toBeVisible();
  // Before a desk is chosen: one list, all chambers.
  await expect(page.getByTestId('picker-desk-all')).toHaveAttribute('aria-pressed', 'true');
  const all = await cards.count();

  await page.getByTestId(`picker-desk-${deskId}`).click();
  await expect(page.getByTestId('picker-group-pickerDeskChambers')).toBeVisible();
  await expect(page.getByTestId('picker-group-pickerOtherChambers')).toBeVisible();
  // Nothing hidden: the same chambers, in a different order.
  await expect(cards).toHaveCount(all);

  // Remembered on this device.
  await page.reload();
  await page.getByTestId(`pick-hospital-${hospitalId}`).click();
  await expect(page.getByTestId(`picker-desk-${deskId}`)).toHaveAttribute('aria-pressed', 'true');
});
