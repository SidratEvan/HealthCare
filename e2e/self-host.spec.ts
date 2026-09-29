/**
 * `e2e/self-host.spec.ts` — a hospital's own server with no merchant account
 * (pilot step 26, `FR-SEC-07`).
 *
 * `PAYMENT_PROVIDER=off` means paying at the hospital only. The API refuses an
 * online method (`deployment.test.ts`); this is the patient's half: the app
 * asks `GET /config` and never offers a bKash button that could not take the
 * money, on the booking form or on the standby list.
 *
 * The suite's API runs the demo, where online payment exists, so the answer to
 * `GET /config` is the one thing stubbed here — as `console-cold-start.spec.ts`
 * stubs `/demo/status`. Everything else is the seeded demo: the booking at the
 * counter is a real booking on a real chamber.
 */

import { expect, test, type Page } from '@playwright/test';

import { bookingBySerial, createConsoleSession, fillSession } from './support/console.js';
import { guestPhone } from './support/patient.js';

const PATIENT = 'http://localhost:3000';

/** What a self-hosted server with no merchant account answers. */
async function withoutOnlinePayments(page: Page): Promise<void> {
  await page.route('**/api/v1/config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: { demo: false, onlinePayments: false, guestPhoneCheck: false },
      }),
    });
  });
}

test.describe('no online payment on this server (PAYMENT_PROVIDER=off)', () => {
  test('the booking form offers the counter only, and the booking completes', async ({ page }) => {
    const demo = await createConsoleSession(3);
    await withoutOnlinePayments(page);

    await page.goto(`${PATIENT}/book?specialty=${demo.departmentCode}`);
    await page.getByTestId(`hospital-${demo.hospitalId}`).click();
    await page.getByTestId(`doctor-${demo.doctorId}`).click();
    await page.getByTestId(`session-${demo.sessionId}`).click();

    // One choice, already chosen, and what is due at the counter said plainly.
    const counter = page.getByRole('button', { name: 'হাসপাতালে দেব' });
    await expect(counter).toBeVisible();
    await expect(counter).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'বিকাশ' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'নগদ' })).toHaveCount(0);
    await expect(page.getByText('হাসপাতালে দিতে হবে')).toBeVisible();

    await page.getByLabel('রোগীর নাম').fill('রহিমা খাতুন');
    await page.getByLabel('মোবাইল নম্বর').fill(guestPhone());
    await page.getByLabel('বয়স').fill('34');
    await page.getByTestId('confirm-booking').click();

    await expect(page.getByTestId('booking-success')).toBeVisible();
    expect(await bookingBySerial(demo.sessionId, 4)).not.toBeNull();
  });

  test('the standby list is joined without a prepayment (FR-PAT-27)', async ({ page }) => {
    const demo = await createConsoleSession(6, 'overdue');
    await fillSession(demo);
    await withoutOnlinePayments(page);

    await page.goto(`${PATIENT}/book?specialty=${demo.departmentCode}`);
    await page.getByTestId(`hospital-${demo.hospitalId}`).click();
    await page.getByTestId(`doctor-${demo.doctorId}`).click();
    await page.getByTestId(`standby-join-${demo.sessionId}`).click();

    const form = page.getByTestId('standby-join');
    await expect(form).toBeVisible();

    // Asked on the phone when a chair frees: the only terms there are.
    await expect(form.getByTestId('standby-choice-ask')).toHaveAttribute('aria-pressed', 'true');
    await expect(form.getByTestId('standby-choice-prepay')).toHaveCount(0);
    await expect(form.getByTestId('standby-prepay-methods')).toHaveCount(0);
  });
});
