/**
 * `e2e/guest-phone-proof.spec.ts` — the phone is proved before a guest acts
 * (`FR-GST-03`, `MOD-GST-OTP`): a booking, a place on a standby list, a bed
 * request. The last two asked for nothing until the security review of
 * 2026-09-30 found that the same name and number, typed by anybody, was handed
 * the existing place or request.
 *
 * The suite's API runs the demo, where the check is off, so one answer is
 * stubbed: `POST /guest/start` says a code is needed, as a real deployment
 * does — the way `self-host.spec.ts` stubs `/config`. The code itself is real.
 * `POST /auth/otp` opens a challenge for the number (the guest's check shares
 * the table and the rules), the demonstration hands its code back and the card
 * shows it, and `POST /guest/verify` proves it against the real server. What
 * is asserted is that the form then carries the guest token it was given.
 */

import { expect, test, type Page, type Request } from '@playwright/test';

import { createConsoleSession, fillSession } from './support/console.js';
import { guestPhone } from './support/patient.js';
import { createWardFixture } from './support/ward.js';

const PATIENT = 'http://localhost:3000';
const API = 'http://localhost:4000/api/v1';

/** Opens a real challenge for the number, and makes `/guest/start` ask for its code. */
async function codeAskedFor(page: Page, phone: string): Promise<void> {
  const sent = await fetch(`${API}/auth/otp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone }),
  });
  const demoCode = ((await sent.json()) as { data?: { demoCode?: string } }).data?.demoCode;
  if (demoCode === undefined)
    throw new Error(`/auth/otp gave no demo code: ${String(sent.status)}`);

  await page.route('**/api/v1/guest/start', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': PATIENT },
      body: JSON.stringify({
        ok: true,
        data: { needsOtp: true, ttlSeconds: 300, resendAfterSeconds: 60, demoCode },
      }),
    });
  });
}

/** Types the code the card shows, the way a person reads it off an SMS. */
async function typeShownCode(page: Page): Promise<void> {
  const card = page.getByTestId('guest-otp');
  await expect(card).toBeVisible();
  const shown = (await card.getByTestId('guest-demo-code').textContent()) ?? '';
  const code = /(\d{6})/.exec(shown)?.[1];
  if (code === undefined) throw new Error(`no demo code on the card: ${shown}`);
  await card.locator('input').first().click();
  await page.keyboard.type(code);
}

function carriesGuestToken(request: Request): boolean {
  return /^Bearer .+/.test(request.headers()['authorization'] ?? '');
}

test('a booking asks for the code, and books with the guest token it proves', async ({ page }) => {
  const demo = await createConsoleSession(3);
  const phone = guestPhone();
  await codeAskedFor(page, phone);

  await page.goto(`${PATIENT}/book?specialty=${demo.departmentCode}`);
  await page.getByTestId(`hospital-${demo.hospitalId}`).click();
  await page.getByTestId(`doctor-${demo.doctorId}`).click();
  await page.getByTestId(`session-${demo.sessionId}`).click();
  await page.getByLabel('রোগীর নাম').fill('রহিমা খাতুন');
  await page.getByLabel('মোবাইল নম্বর').fill(phone);
  await page.getByLabel('বয়স').fill('34');
  await page.getByRole('button', { name: 'বিকাশ' }).click();
  await page.getByTestId('confirm-booking').click();

  const booked = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/v1/bookings'),
  );
  await typeShownCode(page);

  expect(carriesGuestToken(await booked)).toBe(true);
  await expect(page.getByTestId('booking-success')).toBeVisible();

  // Decision 85: the device keeps its proof for the number, so the same phone
  // is not asked again — and only this phone, since the server checks both.
  const kept = await page.evaluate(() => localStorage.getItem('patient.guestDevice'));
  expect(Object.keys(JSON.parse(kept ?? '{}') as Record<string, string>)).toContain(phone);
});

test('a standby place asks for the code, and joins with the guest token it proves', async ({
  page,
}) => {
  const demo = await createConsoleSession(6, 'overdue');
  await fillSession(demo);
  const phone = guestPhone();
  await codeAskedFor(page, phone);

  await page.goto(`${PATIENT}/book?specialty=${demo.departmentCode}`);
  await page.getByTestId(`hospital-${demo.hospitalId}`).click();
  await page.getByTestId(`doctor-${demo.doctorId}`).click();
  await page.getByTestId(`standby-join-${demo.sessionId}`).click();

  const form = page.getByTestId('standby-join');
  await expect(form).toBeVisible();
  await form.getByLabel('রোগীর নাম').fill('জাহানারা বেগম');
  await form.getByLabel('মোবাইল নম্বর').fill(phone.replace(/^\+88/, ''));
  await form.getByLabel('বয়স').fill('52');
  await form.getByTestId('standby-choice-ask').click();
  await form.getByTestId('standby-confirm').click();

  const joined = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/standby'),
  );
  await typeShownCode(page);

  expect(carriesGuestToken(await joined)).toBe(true);
  await expect(page).toHaveURL(/\/standby\?t=/, { timeout: 45_000 });
});

test('a bed request asks for the code, and is filed with the guest token it proves', async ({
  page,
}) => {
  const ward = await createWardFixture(3);
  const phone = guestPhone();
  await codeAskedFor(page, phone);

  await page.goto(`${PATIENT}/beds?kind=general`);
  await page.getByTestId(`request-bed-${ward.hospitalId}`).click();
  const sheet = page.getByTestId('bed-request-sheet');
  await sheet.getByTestId('request-name').fill('হাবিবুর রহমান (ডেমো)');
  await sheet.getByTestId('request-phone').fill(phone.replace(/^\+88/, ''));
  await sheet.getByTestId('request-age').fill('47');
  await sheet.getByRole('button', { name: 'পুরুষ' }).click();
  await sheet.getByTestId('request-send').click();

  const filed = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/v1/bed-requests'),
  );
  await typeShownCode(page);

  expect(carriesGuestToken(await filed)).toBe(true);
  await page.waitForURL(/\/beds\/request/);
});
