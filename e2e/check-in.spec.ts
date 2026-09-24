/**
 * `e2e/check-in.spec.ts` — the patient arrives, and is told how long
 * (`FR-REC-18`, `FR-PAT-38`, `BTN-B02-CHECKIN`).
 *
 * The owner's ruling of 2026-09-23: reception checks a patient in and quotes a
 * wait, the way a restaurant confirms an order with a preparation time. Two
 * devices, as the canary has: reception taps এসেছেন on one, and the patient's
 * phone — opened from the SMS link, no account — shows the counter's word on
 * the other.
 */

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { createConsoleSession, type ConsoleSession } from './support/console.js';
import { bengali, latin } from './support/digits.js';
import { bookAsGuest, openLiveSerial } from './support/patient.js';

const CONSOLE = 'http://localhost:3100';

let demo: ConsoleSession;

test.beforeEach(async () => {
  demo = await createConsoleSession(8);
});

async function openReception(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.addInitScript((token: string) => {
    window.sessionStorage.setItem(
      'console.demo-session',
      JSON.stringify({ token, hospitalId: 'e2e', staffName: 'E2E', role: 'receptionist' }),
    );
  }, demo.token);
  await page.goto(`${CONSOLE}/?session=${demo.sessionId}`);
  await expect(page.getByTestId('queue-table')).toBeVisible();
  return page;
}

test.describe('checking a patient in (FR-REC-18)', () => {
  test('reception quotes a wait, and the patient’s phone shows it (FR-PAT-38)', async ({
    browser,
  }) => {
    const phone = await browser.newContext();
    const counter = await browser.newContext();

    const booking = await phone.newPage();
    const link = await bookAsGuest(booking, demo);
    const live = await openLiveSerial(phone, link);

    // Not yet checked in: no quote on the phone.
    await expect(live.getByTestId('counter-quote')).toHaveCount(0);

    const reception = await openReception(counter);

    // The guest took serial 9, after the eight the fixture booked.
    await reception.getByTestId('check-in-9').click();

    const sheet = reception.getByTestId('check-in-sheet');
    await expect(sheet).toBeVisible();

    // Pre-filled from the queue's estimate; reception adds five minutes
    // because it can see something the rolling rate cannot.
    const suggested = Number(
      latin(await sheet.getByTestId('check-in-minutes').innerText()).replace(/\D/g, ''),
    );
    await sheet.getByTestId('check-in-more').click();
    await expect(sheet.getByTestId('check-in-minutes')).toContainText(bengali(suggested + 5));
    await sheet.getByTestId('check-in-confirm').click();

    // The row says the patient is here, and what they were told.
    const row = reception.getByTestId('queue-row-9');
    await expect(row).toContainText('এসেছেন');
    await expect(reception.getByTestId('quoted-9')).toContainText(bengali(suggested + 5));
    await expect(reception.getByTestId('check-in-9')).toHaveCount(0);

    // The phone, on the other device, has the counter's word within the
    // canary's budget — and has stopped telling somebody already here to
    // leave home.
    await expect(live.getByTestId('counter-quote')).toBeVisible({ timeout: 2_000 });
    await expect(live.getByTestId('leave-now')).toHaveCount(0);
    await expect(live.getByTestId('counter-quote-left')).toBeVisible();

    await phone.close();
    await counter.close();
  });

  test('a check-in made offline is queued and lands on reconnect (FR-OFF-01)', async ({
    browser,
  }) => {
    const counter = await browser.newContext();
    const reception = await openReception(counter);

    await counter.setOffline(true);
    await reception.getByTestId('check-in-4').click();
    await reception.getByTestId('check-in-confirm').click();

    // Applied here at once, while the outbox holds it (`FR-QUE-50`).
    await expect(reception.getByTestId('queue-row-4')).toContainText('এসেছেন');

    await counter.setOffline(false);

    // Once it has synced, a fresh console sees it too: it is in the log.
    const second = await openReception(await browser.newContext());
    await expect(second.getByTestId('queue-row-4')).toContainText('এসেছেন', { timeout: 10_000 });
  });
});
