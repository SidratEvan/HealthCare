/**
 * `e2e/patient-account.spec.ts` — a patient verifies a phone and sees what was
 * made under it (pilot step 25, `S-A-03`, `S-A-04`, `S-A-20`, `FR-PAT-01`,
 * `FR-GST-09`).
 *
 * The whole path the step promises: somebody books as a guest with a number,
 * is seen and a record signed; later, on another phone, they sign in with that
 * number and the code, are shown what it holds, add it in one step, and read
 * the record under their account. The demo returns the code on screen
 * (`DEMO_MODE`); a real deployment only sends it by SMS.
 */

import { expect, test } from '@playwright/test';

import { DEMO_ASSESSMENTS } from '../database/seeds/data/reference.js';

import {
  bookingBySerial,
  createConsoleSession,
  signVisit,
  type ConsoleSession,
} from './support/console.js';
import { closeOtherContexts } from './support/contexts.js';

const PATIENT = 'http://localhost:3000';
const GUEST_NAME = 'সুমাইয়া ইসলাম';
const ASSESSMENT = DEMO_ASSESSMENTS[0];

let chamber: ConsoleSession;

test.beforeAll(async () => {
  chamber = await createConsoleSession(1);
});

// Second devices close after each test, or their pages poll the API for the
// rest of the run (`support/contexts.ts`).
test.afterEach(async ({ browser, context }) => {
  await closeOtherContexts(browser, context);
});

test('a guest signs in later with the same number and finds the record', async ({ browser }) => {
  test.setTimeout(150_000);
  if (ASSESSMENT === undefined) throw new Error('the seed declares no assessments');
  const tail = String(Math.floor(Math.random() * 90_000_000) + 10_000_000);
  const phone = `019${tail}`;

  // --- the guest books, on the first phone ------------------------------------
  const first = await browser.newContext();
  const booking = await first.newPage();
  await booking.goto(`${PATIENT}/book?specialty=${chamber.departmentCode}`);
  await booking.getByTestId(`hospital-${chamber.hospitalId}`).click();
  await booking.getByTestId(`doctor-${chamber.doctorId}`).click();
  await booking.getByTestId(`session-${chamber.sessionId}`).click();
  await booking.getByLabel('রোগীর নাম').fill(GUEST_NAME);
  await booking.getByLabel('মোবাইল নম্বর').fill(phone);
  await booking.getByLabel('বয়স').fill('29');
  await booking.getByTestId('confirm-booking').click();
  await expect(booking.getByTestId('booking-success')).toBeVisible();
  await first.close();

  // --- seen: serial 1 finished, the guest called in, and their record signed ---
  const serialOne = chamber.bookingsBySerial.get(1);
  const guest = await bookingBySerial(chamber.sessionId, 2);
  if (serialOne === undefined || guest === null) throw new Error('the chamber is not as built');
  await signVisit(chamber, serialOne, {
    diagnosisText: ASSESSMENT.diagnosisBn,
    adviceTextBn: ASSESSMENT.adviceBn,
  });
  await signVisit(chamber, guest.id, {
    diagnosisText: ASSESSMENT.diagnosisBn,
    adviceTextBn: ASSESSMENT.adviceBn,
  });

  // --- later, another phone: sign in with the number ---------------------------
  const second = await browser.newContext();
  const page = await second.newPage();
  await page.goto(`${PATIENT}/profile`);
  await page.getByTestId('signin-phone-input').fill(phone);
  await page.getByTestId('signin-send').click();
  await expect(page.getByTestId('signin-code')).toBeVisible();
  const shown = (await page.getByTestId('signin-demo-code').textContent()) ?? '';
  const code = /(\d{6})/.exec(shown)?.[1];
  if (code === undefined) throw new Error(`no demo code on screen: ${shown}`);
  await page.getByTestId('signin-code').locator('input').first().click();
  await page.keyboard.type(code);

  // --- S-A-20: what the number holds, added in one step -----------------------
  const claim = page.getByTestId('claim');
  await expect(claim).toBeVisible();
  await expect(claim).toContainText(GUEST_NAME);
  await page.getByTestId('claim-confirm').click();

  // --- the record, under the account -------------------------------------------
  const account = page.getByTestId('account');
  await expect(account).toBeVisible();
  await expect(account).toContainText(GUEST_NAME);
  await expect(account.getByTestId('account-visit').first()).toContainText(ASSESSMENT.diagnosisBn);
  await expect(page.getByTestId('account-phone')).toHaveText(`+88${phone}`);
  // Family accounts are not in V1 (owner, 8 October; `FR-PAT-02`): the people
  // under the number are listed, and nothing calls them a family.
  await expect(account).toContainText('এই নম্বরে বুক করা রোগী');
  await expect(account).not.toContainText('পরিবার');

  // --- an old paper, kept under the profile (FR-PAT-62, plan R3) ---------------
  const papers = account
    .locator('[data-testid^="papers-"]')
    .filter({
      has: page.getByTestId('papers-form'),
    })
    .first();
  await expect(papers.getByTestId('papers-none')).toBeVisible();
  await papers.getByTestId('papers-file').setInputFiles({
    name: 'old-prescription.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n% demo paper\n%%EOF\n', 'utf8'),
  });
  await papers.getByTestId('papers-kind').selectOption('report');
  await papers.getByTestId('papers-doctor').fill('ডা. পরীক্ষা (ডেমো)');
  await papers.getByTestId('papers-add').click();
  await expect(papers.getByTestId('papers-added')).toBeVisible();
  const list = papers.getByTestId('papers-list');
  await expect(list).toContainText('টেস্টের রিপোর্ট');
  // Labelled as the patient's own wherever it is shown.
  await expect(list).toContainText('রোগীর দেওয়া কাগজ');

  // A page named like a PDF is read by its bytes and refused, in plain words.
  await papers.getByTestId('papers-file').setInputFiles({
    name: 'not-really.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('<html>not a paper</html>', 'utf8'),
  });
  await papers.getByTestId('papers-add').click();
  await expect(papers.getByTestId('papers-problem')).toContainText('শুধু ছবি');

  // Removed, after asking twice.
  await list.locator('[data-testid^="paper-remove-"]').first().click();
  await list.locator('[data-testid^="paper-remove-sure-"]').first().click();
  await expect(papers.getByTestId('papers-none')).toBeVisible();

  // Signing out forgets the account on this phone.
  await page.getByTestId('account-sign-out').click();
  await expect(page.getByTestId('signin-phone')).toBeVisible();
  await second.close();
});
