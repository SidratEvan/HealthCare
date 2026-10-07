/**
 * `e2e/patient-account-serials.spec.ts` — a signed-in patient's serials are
 * the account's, on any phone, and they book as themselves (plan F1;
 * `FR-PAT-03`, `FR-PAT-39`, `FR-GST-10`; `S-A-09`, `MOD-A07-PROFILE`).
 *
 * Until this branch My serials was whatever one phone remembered, and a
 * signed-in patient still typed their name, number and age to book. What this
 * walks, on three phones that share nothing but a mobile number:
 *
 * 1. somebody books as a guest on the first phone;
 * 2. on a second phone they sign in with that number and take what it holds.
 *    My serials there lists the serial, though that phone never booked it,
 *    and says the list is the account's; the live screen opens from it, with
 *    no link in an SMS on that phone; and it can be cancelled from there;
 * 3. still on the second phone they book again: no name, number or age is
 *    asked for, only which of their profiles the serial is for;
 * 4. on a third phone, signed in, both serials are there: the new one
 *    current, the cancelled one past, and Home shows the current one.
 */

import { expect, test, type Page } from '@playwright/test';

import { bookingBySerial, createConsoleSession, type ConsoleSession } from './support/console.js';
import { closeOtherContexts } from './support/contexts.js';

const PATIENT = 'http://localhost:3000';
const NAME = 'নাসরিন আক্তার';

let chamber: ConsoleSession;

test.beforeAll(async () => {
  chamber = await createConsoleSession(1);
});

// Second devices close after each test, or their pages poll the API for the
// rest of the run (`support/contexts.ts`).
test.afterEach(async ({ browser, context }) => {
  await closeOtherContexts(browser, context);
});

/** `S-A-03`, `S-A-04`: the number, then the code the demonstration shows on screen. */
async function signIn(page: Page, phone: string): Promise<void> {
  await page.goto(`${PATIENT}/profile`);
  await page.getByTestId('signin-phone-input').fill(phone);
  await page.getByTestId('signin-send').click();
  await expect(page.getByTestId('signin-code')).toBeVisible();
  const shown = (await page.getByTestId('signin-demo-code').textContent()) ?? '';
  const code = /(\d{6})/.exec(shown)?.[1];
  if (code === undefined) throw new Error(`no demo code on screen: ${shown}`);
  await page.getByTestId('signin-code').locator('input').first().click();
  await page.keyboard.type(code);
}

async function toTheConfirmStep(page: Page): Promise<void> {
  await page.goto(`${PATIENT}/book?specialty=${chamber.departmentCode}`);
  await page.getByTestId(`hospital-${chamber.hospitalId}`).click();
  await page.getByTestId(`doctor-${chamber.doctorId}`).click();
  await page.getByTestId(`session-${chamber.sessionId}`).click();
}

test('the same serials on every phone the account is signed in on, and booking with nothing retyped', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const phone = `019${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}`;

  // --- 1. a guest books, on the first phone -----------------------------------
  const firstPhone = await browser.newContext();
  const guest = await firstPhone.newPage();
  await toTheConfirmStep(guest);
  // Nobody is signed in: the guest sheet, as always.
  await expect(guest.getByTestId('booking-profiles')).toHaveCount(0);
  await guest.getByLabel('রোগীর নাম').fill(NAME);
  await guest.getByLabel('মোবাইল নম্বর').fill(phone);
  await guest.getByLabel('বয়স').fill('31');
  await guest.getByTestId('confirm-booking').click();
  await expect(guest.getByTestId('booking-success')).toBeVisible({ timeout: 45_000 });
  await firstPhone.close();

  const first = await bookingBySerial(chamber.sessionId, 2);
  if (first === null) throw new Error('the guest was not given serial 2');

  // --- 2. a second phone: signed in, the serial is there -----------------------
  const secondPhone = await browser.newContext();
  const page = await secondPhone.newPage();
  await signIn(page, phone);
  await expect(page.getByTestId('claim')).toContainText(NAME);
  await page.getByTestId('claim-confirm').click();
  await expect(page.getByTestId('account')).toBeVisible();

  await page.goto(`${PATIENT}/serials`);
  // The account's list, and the screen says so.
  await expect(page.getByTestId('serials-source')).toHaveAttribute('data-source', 'account');
  const listed = page.getByTestId('serials-current').getByTestId(`serial-${first.id}`);
  await expect(listed).toBeVisible();

  // Its live screen opens from the list. This phone holds no link for it: it
  // asks for one, which the server gives for the account's own booking.
  await listed.click();
  await expect(page.getByTestId('live-serial')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId('live-serial-number')).toHaveText('২');
  await expect(page).toHaveURL(/\/s\?b=[0-9a-f-]+&t=.+/);

  // And it is theirs to cancel from here.
  await page.getByTestId('cancel-booking').click();
  await page.getByTestId('cancel-confirm').click();
  await expect(page.getByTestId('live-serial-notice')).toHaveText('সিরিয়াল বাতিল করা হয়েছে');

  // --- 3. booking again, as themselves ------------------------------------------
  await toTheConfirmStep(page);
  const profiles = page.getByTestId('booking-profiles');
  await expect(profiles).toBeVisible();
  // The profile carries the name, the age and the number: none is asked for.
  await expect(profiles.getByRole('button', { pressed: true })).toContainText(NAME);
  await expect(page.getByLabel('রোগীর নাম')).toHaveCount(0);
  await expect(page.getByLabel('মোবাইল নম্বর')).toHaveCount(0);
  await expect(page.getByLabel('বয়স')).toHaveCount(0);

  // Somebody else can still be booked for, on the sheet a guest uses, and back.
  await page.getByTestId('booking-for-someone-else').click();
  await expect(page.getByLabel('মোবাইল নম্বর')).toBeVisible();
  await page.getByTestId('booking-for-own-profile').click();
  await expect(page.getByLabel('মোবাইল নম্বর')).toHaveCount(0);

  await page.getByTestId('confirm-booking').click();
  await expect(page.getByTestId('booking-success')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId('serial')).toHaveText('৩');
  // A link to the live screen, as a guest is given.
  await expect(page.getByTestId('tracking-link')).toBeVisible();
  await secondPhone.close();

  const second = await bookingBySerial(chamber.sessionId, 3);
  if (second === null) throw new Error('the account was not given serial 3');
  // Made by the account, in the app: not a guest's booking.
  expect(second.source).toBe('app');

  // --- 4. a third phone, signed in: both are there -------------------------------
  const thirdPhone = await browser.newContext();
  const other = await thirdPhone.newPage();
  await signIn(other, phone);
  // Nothing left to take: straight to the account.
  await expect(other.getByTestId('account')).toBeVisible({ timeout: 30_000 });

  await other.goto(`${PATIENT}/serials`);
  await expect(other.getByTestId('serials-source')).toHaveAttribute('data-source', 'account');
  await expect(
    other.getByTestId('serials-current').getByTestId(`serial-${second.id}`),
  ).toBeVisible();
  await expect(other.getByTestId('serials-past').getByTestId(`serial-${first.id}`)).toBeVisible();

  // Home's strip is the same serial, on a phone that never booked anything.
  await other.goto(PATIENT);
  await expect(other.getByTestId('active-serial')).toBeVisible({ timeout: 30_000 });
  await other.getByTestId('active-serial').click();
  await expect(other.getByTestId('live-serial-number')).toHaveText('৩', { timeout: 45_000 });

  // Signed out, the phone is a guest's again: it holds nothing of the account.
  await other.goto(`${PATIENT}/profile`);
  await other.getByTestId('account-sign-out').click();
  await expect(other.getByTestId('signin-phone')).toBeVisible();
  await other.goto(`${PATIENT}/serials`);
  await expect(other.getByTestId('serials-empty')).toBeVisible();
  await thirdPhone.close();
});
