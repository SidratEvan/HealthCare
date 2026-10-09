/**
 * Payment first, after three no-shows, said on the patient's screen (plan F3;
 * `PRD.md` `FR-GST-14`, `FR-PAY-02`; `BACKEND.md` §9 `PREPAYMENT_REQUIRED`).
 *
 * The rule itself (off by default, this hospital's no-shows only, the
 * hospital's window, nothing written when refused) is proven in
 * `noshowPrepay.routes.test.ts`. Here, that a person who chooses the counter
 * is told why this serial is paid online first, in plain words, and not
 * "something went wrong".
 */

import { expect, test } from '@playwright/test';
import { Client } from 'pg';

import { createConsoleSession, type ConsoleSession } from './support/console.js';
import { E2E_DATABASE_URL, assertLocalDatabase } from './support/database.js';

const PATIENT = 'http://localhost:3000';

let demo: ConsoleSession;
let phone: string;

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

/** A demonstration number with three no-shows at the hospital in the last month. */
async function threeNoShows(client: Client): Promise<void> {
  const guest = await client.query<{ id: string }>(
    `INSERT INTO guest_identities (phone, display_name) VALUES ($1, 'নাসিমা (ডেমো)') RETURNING id`,
    [phone],
  );
  const past = await client.query<{ id: string }>(
    `SELECT id FROM sessions
      WHERE hospital_id = $1
        AND session_date < (now() AT TIME ZONE 'Asia/Dhaka')::date
        AND session_date >= (now() AT TIME ZONE 'Asia/Dhaka')::date - 30
      ORDER BY session_date DESC LIMIT 1`,
    [demo.hospitalId],
  );
  const sessionId = past.rows[0]?.id;
  if (sessionId === undefined) throw new Error('the seed should hold past sessions (FR-DEM-02)');
  const patients = await client.query<{ id: string }>(
    `SELECT id FROM patients p
      WHERE p.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.patient_id = p.id AND b.session_id = $1)
      ORDER BY random() LIMIT 3`,
    [sessionId],
  );
  for (const [index, patient] of patients.rows.entries()) {
    await client.query(
      `INSERT INTO bookings
         (session_id, patient_id, serial_number, source, fee_poisha, intake,
          booked_by_guest_id, status)
       VALUES ($1, $2, $3, 'guest_link', 50000, '{"demo":true}'::jsonb, $4, 'no_show')`,
      [sessionId, patient.id, 900 + index + Math.floor(Math.random() * 90), guest.rows[0]?.id],
    );
  }
}

async function rule(client: Client, on: boolean): Promise<void> {
  await client.query(
    `INSERT INTO hospital_settings (hospital_id) VALUES ($1) ON CONFLICT (hospital_id) DO NOTHING`,
    [demo.hospitalId],
  );
  await client.query(`UPDATE hospital_settings SET noshow_prepay = $2 WHERE hospital_id = $1`, [
    demo.hospitalId,
    on,
  ]);
}

test.beforeEach(async () => {
  demo = await createConsoleSession(2);
  phone = `+88019${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}`;
  await withClient(async (client) => {
    await threeNoShows(client);
    await rule(client, true);
  });
});

test.afterEach(async () => {
  await withClient(async (client) => {
    await rule(client, false);
  });
});

test('choosing the counter after three no-shows says why this serial is paid first (FR-GST-14)', async ({
  page,
}) => {
  await page.goto(`${PATIENT}/book?specialty=${demo.departmentCode}`);
  await page.getByTestId(`hospital-${demo.hospitalId}`).click();
  await page.getByTestId(`doctor-${demo.doctorId}`).click();
  await page.getByTestId(`session-${demo.sessionId}`).click();
  await page.getByLabel('রোগীর নাম').fill('নাসিমা আক্তার (ডেমো)');
  await page.getByLabel('মোবাইল নম্বর').fill(phone);
  await page.getByLabel('বয়স').fill('38');
  await page.getByRole('button', { name: 'হাসপাতালে দেব' }).click();
  await page.getByTestId('confirm-booking').click();

  await expect(
    page.getByRole('alert').filter({ hasText: 'আগের তিনটি সিরিয়ালে আসা হয়নি' }),
  ).toBeVisible();
  await expect(page.getByTestId('booking-success')).toHaveCount(0);
});
