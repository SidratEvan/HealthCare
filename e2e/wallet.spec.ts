/**
 * `e2e/wallet.spec.ts` — `S-A-12` the health wallet and `BTN-B05-SCAN` (step 13).
 *
 * Two promises, both only provable through the screens:
 *
 * - **A visit produces a record the patient can open** (`PRD.md` §26, P2's exit
 *   criterion). A doctor signs, and the patient's phone shows the diagnosis and
 *   the advice — not a row somebody inserted.
 * - **Consent + audit rows are written on every view** (`CLAUDE.md` §4, step
 *   13's definition of done). The patient shows a code, a doctor enters it, and
 *   the patient can then see that hospital's access and who looked, and end it
 *   (`FR-PAT-63`, `FR-PAT-64`).
 *
 * ## Why the guest books through the screens
 *
 * The wallet reads the tracking links this device holds (there are no accounts,
 * `CLAUDE.md` §4.1), so the only honest way to put a record in it is the way a
 * patient does: book, and let the app keep the link.
 */

import { expect, test, type Page } from '@playwright/test';

import { DEMO_ASSESSMENTS } from '../database/seeds/data/reference.js';

import {
  bookingBySerial,
  consentTrail,
  createConsoleSession,
  revokeTrackingLink,
  signVisit,
  type ConsoleSession,
} from './support/console.js';

const PATIENT = 'http://localhost:3000';
const CONSOLE = 'http://localhost:3100';

/** From the seed's declared set, so the spec invents no clinical content (CLAUDE.md §8). */
const ASSESSMENT = DEMO_ASSESSMENTS[0];

let demo: ConsoleSession;

test.beforeEach(async () => {
  // One seeded patient in the chamber; the guest this spec books is serial 2.
  demo = await createConsoleSession(1);
});

/** A phone nobody else in the run will use (`DB-P6` normalised). */
function guestPhone(): string {
  const tail = String(Math.floor(Math.random() * 90_000_000) + 10_000_000);
  return `+88019${tail}`;
}

/** Books serial 2 as a guest, leaving the link on this device. Returns the booking id. */
async function bookAsGuest(page: Page): Promise<string> {
  await page.goto(`${PATIENT}/book?specialty=${demo.departmentCode}`);

  await page.getByTestId(`hospital-${demo.hospitalId}`).click();
  await page.getByTestId(`doctor-${demo.doctorId}`).click();
  await page.getByTestId(`session-${demo.sessionId}`).click();

  await page.getByLabel('রোগীর নাম').fill('রহিমা খাতুন');
  await page.getByLabel('মোবাইল নম্বর').fill(guestPhone());
  await page.getByLabel('বয়স').fill('34');
  await page.getByTestId('confirm-booking').click();

  await expect(page.getByTestId('booking-success')).toBeVisible();

  const booking = await bookingBySerial(demo.sessionId, 2);
  if (booking === null) throw new Error('the guest booking was not written');
  return booking.id;
}

/** The doctor finishes serial 1, which calls the guest, then files the guest's record. */
async function seeTheGuest(guestBookingId: string): Promise<void> {
  if (ASSESSMENT === undefined) throw new Error('the seed declares no assessments');

  const first = demo.bookingsBySerial.get(1);
  if (first === undefined) throw new Error('no serial 1');

  await signVisit(demo, first, {
    diagnosisText: ASSESSMENT.diagnosisBn,
    adviceTextBn: ASSESSMENT.adviceBn,
  });
  await signVisit(demo, guestBookingId, {
    diagnosisText: ASSESSMENT.diagnosisBn,
    adviceTextBn: ASSESSMENT.adviceBn,
  });
}

/** The doctor console on the fixture's chamber, entered as the picker would. */
async function openDoctorConsole(page: Page): Promise<void> {
  await page.addInitScript(
    ([token, hospitalId]) => {
      sessionStorage.setItem(
        'console.demo-session',
        JSON.stringify({ token, hospitalId, staffName: 'Doctor (Demo)', role: 'doctor' }),
      );
    },
    [demo.doctorToken, demo.hospitalId],
  );

  await page.goto(`${CONSOLE}/?session=${demo.sessionId}`);
}

test.describe('S-A-12 the timeline', () => {
  test('an empty wallet says so, and names what it cannot hold yet', async ({ page }) => {
    await page.goto(`${PATIENT}/records`);

    await expect(page.getByTestId('records-empty')).toBeVisible();

    // `PRD.md` §3.2: no empty Reports tab implying the patient has none.
    await expect(page.getByTestId('wallet-absent')).toBeVisible();

    // Nothing on this device can speak for anybody, so there is nothing to
    // offer a doctor.
    await expect(page.locator('[data-testid^="wallet-consent-"]')).toHaveCount(0);
  });

  test('a booked visit is not a record until it happens', async ({ page }) => {
    await bookAsGuest(page);
    await page.goto(`${PATIENT}/records`);

    // Counted, not listed: the wallet says a record will come after the visit.
    await expect(page.getByTestId('records-empty')).toContainText('১টি সিরিয়াল');
    await expect(page.getByTestId('record-list')).toHaveCount(0);
  });

  test('a signed visit lands in the wallet (PRD.md §26, P2)', async ({ page }) => {
    const bookingId = await bookAsGuest(page);
    await seeTheGuest(bookingId);

    await page.goto(`${PATIENT}/records`);

    const list = page.getByTestId('record-list');
    await expect(list).toBeVisible();
    await expect(list).toContainText(ASSESSMENT?.diagnosisBn ?? '');
    await expect(list).toContainText(ASSESSMENT?.adviceBn ?? '');
  });

  test('an expired link is said, not hidden (FR-GST-08)', async ({ page }) => {
    const bookingId = await bookAsGuest(page);
    await revokeTrackingLink(bookingId);

    await page.goto(`${PATIENT}/records`);

    // The record is real but out of this phone's reach, and the screen says
    // which of those is true rather than pretending there is nothing.
    await expect(page.getByTestId('records-expired')).toBeVisible();
    await expect(page.getByTestId('records-empty')).toBeVisible();
  });
});

test.describe('the four states (GR-03)', () => {
  test('a failed request is an error with a retry, not an empty wallet', async ({ page }) => {
    await bookAsGuest(page);

    await page.route('**/guest/link/**', (route) => route.abort());
    await page.goto(`${PATIENT}/records`);

    await expect(page.getByTestId('records-error')).toBeVisible();
    await expect(page.getByTestId('records-empty')).toHaveCount(0);

    await page.unroute('**/guest/link/**');
    await page.getByTestId('records-retry').click();

    await expect(page.getByTestId('records-empty')).toBeVisible();
  });

  test('offline says so and disables what needs a connection', async ({ page, context }) => {
    await bookAsGuest(page);
    await page.goto(`${PATIENT}/records`);
    await expect(page.getByTestId('records-empty')).toBeVisible();

    await context.setOffline(true);

    await expect(page.getByTestId('records-offline')).toBeVisible();
    await expect(page.getByTestId('show-consent-code')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'কোড দেখান' })).toBeDisabled();

    await context.setOffline(false);
  });
});

test.describe('consent, end to end (FR-PAT-63, FR-PAT-64)', () => {
  test('the patient shows a code, the doctor opens the records, the patient sees and ends it', async ({
    page,
    browser,
  }) => {
    const bookingId = await bookAsGuest(page);
    await seeTheGuest(bookingId);

    // --- the patient's phone: BTN-A12-QR ------------------------------------
    await page.goto(`${PATIENT}/records`);
    await page.getByTestId('show-consent-code').click();

    // Scope and expiry are stated before anything is handed over.
    await expect(page.getByTestId('consent-scope')).toContainText('২৪ ঘণ্টা');

    const code = (await page.getByTestId('consent-code').textContent())?.trim() ?? '';
    expect(code.length).toBeGreaterThan(16);

    // --- the doctor's console, another device: BTN-B05-SCAN -----------------
    const doctorContext = await browser.newContext();
    const doctor = await doctorContext.newPage();
    await openDoctorConsole(doctor);

    await doctor.getByTestId('consent-code-input').fill(code);
    await doctor.getByTestId('open-consented-records').click();

    const opened = doctor.getByTestId('consented-records');
    await expect(opened).toBeVisible();
    await expect(doctor.getByTestId('consent-granted')).toContainText('রহিমা খাতুন');
    await expect(opened).toContainText(ASSESSMENT?.diagnosisBn ?? '');

    await doctorContext.close();

    // Consent + audit rows on every view: the grant, the handover and the read.
    const granted = await consentTrail(bookingId);
    expect(granted.grants).toBe(1);
    expect(granted.revoked).toBe(0);
    expect(granted.staffReads).toBeGreaterThanOrEqual(2);

    // --- back on the phone: BTN-A12-ACCESS ----------------------------------
    await page.getByRole('button', { name: 'বন্ধ করুন', exact: true }).click();
    await page.getByTestId('show-access').click();

    const log = page.getByTestId('access-log');
    const grant = log.locator('[data-testid^="grant-"]');
    await expect(grant).toHaveCount(1);
    await expect(grant).toContainText('পর্যন্ত চালু');

    // "The patient can see who viewed their records and when."
    await expect(log.getByTestId('access-views').locator('li')).not.toHaveCount(0);

    // Revocable per hospital, and the row survives as a timestamp (`DB-P2`).
    await log.locator('[data-testid^="revoke-"]').click();
    await expect(grant).toContainText('বন্ধ করা হয়েছে');

    const ended = await consentTrail(bookingId);
    expect(ended.grants).toBe(1);
    expect(ended.revoked).toBe(1);
  });

  test('a code that does not work says so, and asks for a new one', async ({ page }) => {
    await openDoctorConsole(page);

    await page.getByTestId('consent-code-input').fill('not-a-real-consent-code-at-all');
    await page.getByTestId('open-consented-records').click();

    await expect(page.getByText(/নতুন কোড দেখাতে বলুন/)).toBeVisible();
    await expect(page.getByTestId('consented-records')).toHaveCount(0);
  });
});
