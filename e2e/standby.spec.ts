/**
 * `e2e/standby.spec.ts` — the patient's half of the standby list
 * (`FR-PAT-25`, `FR-PAT-26`, `FR-PAT-27`, `FR-QUE-30`).
 *
 * The owner's ruling on STATUS decision 62, 2026-09-23: "prepaid gets it
 * automatically". Two devices, as the canary has: a phone joins a full
 * chamber's list from the booking flow, and reception frees a chair on the
 * console. Somebody who paid when joining is seated with nobody asking them;
 * somebody who did not is asked on their phone and says yes there; and a no
 * passes the chair to the next person.
 */

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { createConsoleSession, fillSession, type ConsoleSession } from './support/console.js';
import { bengali } from './support/digits.js';
import { joinStandbyAsGuest } from './support/patient.js';

const CONSOLE = 'http://localhost:3100';

/** The status page polls every five seconds; an offer or a seat lands inside two polls. */
const POLL_BUDGET_MS = 12_000;

let demo: ConsoleSession;

test.beforeEach(async () => {
  // Serial 2 at the front of an empty chamber, its grace long run out, and the
  // chamber full so its standby list is offered to the phone.
  demo = await createConsoleSession(6, 'overdue');
  await fillSession(demo);
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

/** Marks serial 2 absent and offers the chair (`BTN-B02-OFFER`). */
async function freeAndOffer(reception: Page): Promise<void> {
  await reception.getByTestId('queue-row-2').getByRole('button', { name: 'অনুপস্থিত' }).click();
  const offer = reception.getByTestId('standby-offer-2');
  await expect(offer).toBeEnabled({ timeout: 10_000 });
  await offer.click();
}

test.describe('a place on the standby list, from the phone (FR-PAT-25)', () => {
  test('paid when joining: seated the moment a chair frees, nobody asked (FR-PAT-26)', async ({
    browser,
  }) => {
    const phone = await browser.newContext();
    const counter = await browser.newContext();

    const patient = await phone.newPage();
    await joinStandbyAsGuest(patient, demo, true);

    await expect(patient.getByTestId('standby-prepaid')).toBeVisible();
    await expect(patient.getByTestId('standby-ahead')).toBeVisible();

    const reception = await openReception(counter);
    // Reception knows before tapping that the offer will seat somebody.
    await expect(reception.getByTestId('standby-prepaid-count')).toBeVisible({ timeout: 35_000 });

    await freeAndOffer(reception);

    // Taken at once, in the same tap: the card shows it accepted.
    await expect(reception.getByTestId('standby-accepted')).toBeVisible({ timeout: 10_000 });

    // The phone: seated, with the way to the live serial.
    const status = patient.getByTestId('standby-status');
    await expect(status).toHaveAttribute('data-state', 'seated', { timeout: POLL_BUDGET_MS });
    await expect(patient.getByTestId('standby-seated')).toBeVisible();

    await patient.getByTestId('standby-live-link').click();
    await expect(patient.getByTestId('live-serial')).toBeVisible();

    await phone.close();
    await counter.close();
  });

  test('not paid: the offer reaches the phone, and yes makes a booking (FR-PAT-27)', async ({
    browser,
  }) => {
    const phone = await browser.newContext();
    const counter = await browser.newContext();

    const patient = await phone.newPage();
    await joinStandbyAsGuest(patient, demo, false);
    await expect(patient.getByTestId('standby-ask')).toBeVisible();

    const reception = await openReception(counter);
    await expect(reception.getByTestId('standby-waiting')).toContainText(bengali(1), {
      timeout: 35_000,
    });
    await freeAndOffer(reception);

    // Asked, on the phone, with the minutes it has to answer in.
    const offer = patient.getByTestId('standby-offer');
    await expect(offer).toBeVisible({ timeout: POLL_BUDGET_MS });
    await expect(patient.getByTestId('standby-offer-left')).toBeVisible();

    await offer.getByRole('button', { name: 'বিকাশ' }).click();
    await patient.getByTestId('standby-accept').click();

    await expect(patient.getByTestId('standby-seated')).toBeVisible({ timeout: 10_000 });
    await patient.getByTestId('standby-live-link').click();
    await expect(patient.getByTestId('live-serial')).toBeVisible();

    // And reception's card says the chair was taken.
    await expect(reception.getByTestId('standby-accepted')).toBeVisible({ timeout: 20_000 });

    await phone.close();
    await counter.close();
  });

  test('no passes the chair to the next person on the list (FR-QUE-30)', async ({ browser }) => {
    const first = await browser.newContext();
    const second = await browser.newContext();
    const counter = await browser.newContext();

    const firstPhone = await first.newPage();
    await joinStandbyAsGuest(firstPhone, demo, false);
    const secondPhone = await second.newPage();
    await joinStandbyAsGuest(secondPhone, demo, false);

    const reception = await openReception(counter);
    await expect(reception.getByTestId('standby-waiting')).toContainText(bengali(2), {
      timeout: 35_000,
    });
    await freeAndOffer(reception);

    await expect(firstPhone.getByTestId('standby-offer')).toBeVisible({ timeout: POLL_BUDGET_MS });
    await firstPhone.getByTestId('standby-decline').click();

    // The first is back to waiting; the second is now the one asked.
    await expect(firstPhone.getByTestId('standby-status')).toHaveAttribute(
      'data-state',
      'waiting',
      {
        timeout: POLL_BUDGET_MS,
      },
    );
    await expect(secondPhone.getByTestId('standby-offer')).toBeVisible({ timeout: POLL_BUDGET_MS });

    await first.close();
    await second.close();
    await counter.close();
  });
});
