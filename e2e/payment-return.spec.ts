/**
 * A serial held while it is paid for, on the patient's phone (plan H3;
 * `APP_FLOW.md` `S-A-07d` held, `S-A-07p`; `PRD.md` `FR-PAY-08`, `FR-PAY-09`).
 *
 * The demonstration's provider settles on the spot, so a booking made here is
 * paid at once and the return page is asked about a real paid payment. The
 * held screen and the provider's other answers are what a redirecting provider
 * produces: for those, the real booking's answer is extended on its way to
 * the page, and the server's answer to the return page is given by the test.
 * The server's own refusal to believe a return is proven in
 * `paymentHolds.routes.test.ts`; here, that the page shows the server's word
 * and never the address's.
 */

import { expect, test, type Page } from '@playwright/test';

import { createConsoleSession, type ConsoleSession } from './support/console.js';

const PATIENT = 'http://localhost:3000';

let demo: ConsoleSession;

test.beforeEach(async () => {
  demo = await createConsoleSession(2);
});

function guestPhone(): string {
  return `+88019${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}`;
}

interface Booked {
  readonly bookingId: string;
  readonly paymentId: string;
}

/** Books with bKash through the screens, optionally changing the answer on its way. */
async function bookWithBkash(
  page: Page,
  change?: (data: Record<string, unknown>) => Record<string, unknown>,
): Promise<Booked> {
  let booked: Booked | null = null;
  await page.route('**/api/v1/bookings', async (route) => {
    if (route.request().method() !== 'POST') return await route.continue();
    const response = await route.fetch();
    const json = (await response.json()) as { data: Record<string, unknown> };
    const payment = json.data['payment'] as { id: string };
    booked = { bookingId: String(json.data['bookingId']), paymentId: payment.id };
    await route.fulfill({
      response,
      json: { ...json, data: change === undefined ? json.data : change(json.data) },
    });
  });

  await page.goto(`${PATIENT}/book?specialty=${demo.departmentCode}`);
  await page.getByTestId(`hospital-${demo.hospitalId}`).click();
  await page.getByTestId(`doctor-${demo.doctorId}`).click();
  await page.getByTestId(`session-${demo.sessionId}`).click();
  await page.getByLabel('রোগীর নাম').fill('রহিমা খাতুন (ডেমো)');
  await page.getByLabel('মোবাইল নম্বর').fill(guestPhone());
  await page.getByLabel('বয়স').fill('34');
  await page.getByTestId('confirm-booking').click();
  await expect(page.getByTestId('booking-success')).toBeVisible();
  if (booked === null) throw new Error('the booking answer was not seen');
  return booked;
}

test.describe('the payment return page (S-A-07p, FR-PAY-09)', () => {
  test('a payment the provider settled reads as paid, with the way to the live serial', async ({
    page,
  }) => {
    const { bookingId, paymentId } = await bookWithBkash(page);
    // Settled on the spot: no held card on the success screen.
    await expect(page.getByTestId('payment-hold')).toHaveCount(0);

    await page.goto(
      `${PATIENT}/pay/return?payment=${paymentId}&booking=${bookingId}&status=success`,
    );
    await expect(page.getByTestId('pay-return-paid')).toBeVisible();
    await expect(page.getByTestId('pay-return-live')).toBeVisible();
  });

  test('shows the server’s word, not the address’s: success in the address, pending at the provider', async ({
    page,
  }) => {
    const { bookingId, paymentId } = await bookWithBkash(page);
    await page.route('**/api/v1/bookings/*/payments/*/confirm', async (route) => {
      await route.fulfill({
        json: {
          ok: true,
          data: {
            payment: {
              id: paymentId,
              state: 'pending',
              method: 'bkash',
              amountPoisha: 50_000,
              holdUntil: new Date(Date.now() + 12 * 60_000).toISOString(),
              failureReason: null,
            },
            serial: 'held',
            counterAllowed: true,
            serverTs: new Date().toISOString(),
          },
        },
      });
    });

    await page.goto(
      `${PATIENT}/pay/return?payment=${paymentId}&booking=${bookingId}&status=success`,
    );
    await expect(page.getByTestId('pay-return-pending')).toBeVisible();
    await expect(page.getByTestId('pay-return-paid')).toHaveCount(0);
  });

  test('a cancelled payment offers another try and the counter, while the hold lasts', async ({
    page,
  }) => {
    const { bookingId, paymentId } = await bookWithBkash(page);
    await page.route('**/api/v1/bookings/*/payments/*/confirm', async (route) => {
      await route.fulfill({
        json: {
          ok: true,
          data: {
            payment: {
              id: paymentId,
              state: 'failed',
              method: 'bkash',
              amountPoisha: 50_000,
              holdUntil: new Date(Date.now() + 9 * 60_000).toISOString(),
              failureReason: 'cancelled',
            },
            serial: 'held',
            counterAllowed: true,
            serverTs: new Date().toISOString(),
          },
        },
      });
    });

    await page.goto(
      `${PATIENT}/pay/return?payment=${paymentId}&booking=${bookingId}&status=cancel`,
    );
    await expect(page.getByTestId('pay-return-failed')).toContainText('বাতিল');
    await expect(page.getByTestId('pay-return-retry')).toBeVisible();
    await expect(page.getByTestId('pay-return-counter-choice')).toBeVisible();
  });

  test('a phone that holds no link for the booking is told the result comes by SMS', async ({
    page,
  }) => {
    await page.goto(
      `${PATIENT}/pay/return?payment=01900000-0000-7000-8000-000000000001&booking=01900000-0000-7000-8000-000000000002&status=success`,
    );
    await expect(page.getByTestId('pay-return-no-credential')).toBeVisible();
  });
});

test.describe('a serial held for its payment (S-A-07d, FR-PAY-08)', () => {
  test('shows the countdown, what happens when it runs out, and the way to pay', async ({
    page,
  }) => {
    await bookWithBkash(page, (data) => ({
      ...data,
      paid: false,
      payment: {
        ...(data['payment'] as Record<string, unknown>),
        state: 'pending',
        redirectUrl: `${PATIENT}/pay/return?simulated=1`,
        holdUntil: new Date(Date.now() + 15 * 60_000).toISOString(),
        afterHold: 'counter',
      },
    }));

    const hold = page.getByTestId('payment-hold');
    await expect(hold).toBeVisible();
    await expect(page.getByTestId('payment-hold-left')).toContainText('মিনিটের মধ্যে');
    await expect(hold).toContainText('কাউন্টারে');
    await expect(page.getByTestId('payment-hold-pay')).toHaveText('bKash-এ পরিশোধ করুন');
  });
});
