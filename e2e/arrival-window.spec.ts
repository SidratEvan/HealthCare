/**
 * A preferred hour to arrive, chosen at booking (plan R1; `PRD.md`
 * `FR-PAT-28`; `APP_FLOW.md` `CHIP-A07C-WINDOW`).
 *
 * Where the hospital offers it, the confirm step offers the chamber's hours
 * beside "any time", says plainly that it is a preference and not a set time,
 * keeps the choice on the booking, and repeats it on the success screen. The
 * server's rules (only where offered, only the chamber's own windows, never
 * read by the queue) are proven in `arrivalWindows.routes.test.ts`.
 */

import { expect, test } from '@playwright/test';
import { Client } from 'pg';

import { createConsoleSession, type ConsoleSession } from './support/console.js';
import { E2E_DATABASE_URL, assertLocalDatabase } from './support/database.js';

const PATIENT = 'http://localhost:3000';

let demo: ConsoleSession;

async function withClient<T>(work: (client: Client) => Promise<T>): Promise<T> {
  assertLocalDatabase();
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function offered(on: boolean): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      `INSERT INTO hospital_settings (hospital_id) VALUES ($1) ON CONFLICT (hospital_id) DO NOTHING`,
      [demo.hospitalId],
    );
    await client.query(`UPDATE hospital_settings SET arrival_windows = $2 WHERE hospital_id = $1`, [
      demo.hospitalId,
      on,
    ]);
  });
}

test.beforeEach(async () => {
  demo = await createConsoleSession(1);
  await offered(true);
});

test.afterEach(async () => {
  await offered(false);
});

test('a patient chooses a preferred hour, told it is not a set time, and sees it with the serial', async ({
  page,
}) => {
  await page.goto(`${PATIENT}/book?specialty=${demo.departmentCode}`);
  await page.getByTestId(`hospital-${demo.hospitalId}`).click();
  await page.getByTestId(`doctor-${demo.doctorId}`).click();
  await page.getByTestId(`session-${demo.sessionId}`).click();

  const windows = page.getByTestId('arrival-windows');
  await expect(windows).toBeVisible();
  await expect(page.getByTestId('window-any')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('window-note')).toContainText('নিশ্চিত সময় নয়');

  // The chamber's first hour.
  const first = windows.locator('[data-testid^="window-2"]').first();
  await first.click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');

  await page.getByLabel('রোগীর নাম').fill('রুমানা আক্তার (ডেমো)');
  await page
    .getByLabel('মোবাইল নম্বর')
    .fill(`+88019${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}`);
  await page.getByLabel('বয়স').fill('33');
  await page.getByTestId('confirm-booking').click();

  await expect(page.getByTestId('booking-success')).toBeVisible();
  await expect(page.getByTestId('success-window')).toContainText('আপনার পছন্দের সময়');

  const kept = await withClient(async (client) => {
    const result = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM bookings
        WHERE session_id = $1 AND arrival_window_start IS NOT NULL`,
      [demo.sessionId],
    );
    return Number(result.rows[0]?.n ?? '0');
  });
  expect(kept).toBe(1);
});
