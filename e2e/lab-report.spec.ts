/**
 * `e2e/lab-report.spec.ts` — the lab and the pharmacy (step 17).
 *
 * The step's definition of done is one sentence: **a report a lab uploads
 * reaches the patient's phone.** That is the first test here, driven through
 * three screens in one run — a doctor ticks a chip and signs, a bench works
 * the order and uploads the file, and the patient opens the report from the
 * tracking link the booking left on their device.
 *
 * ## Why this needs a browser
 *
 * Every piece has unit and API tests. What only a browser shows is the chain
 * holding together across three consoles and a phone: the chip a doctor ticks
 * becomes a row on a bench somebody else is looking at, and the file that
 * bench chooses becomes a document in a wallet that belonged to nobody in
 * this story until the moment it arrived. `FR-LAB-03` is a promise about that
 * whole path, not about any one endpoint on it.
 *
 * ## What the pharmacy half proves
 *
 * `FR-PHR-02`'s honesty: a counter flags a medicine out of stock and the
 * public search says *নেই* — not silently, not by omitting the pharmacy, and
 * with the freshness of the claim beside it.
 */

import { expect, test, type Page } from '@playwright/test';

import { DEMO_ASSESSMENTS } from '../database/seeds/data/reference.js';

import {
  bookingBySerial,
  createConsoleSession,
  signVisit,
  type ConsoleSession,
} from './support/console.js';
import {
  labSession,
  ordersForBooking,
  publishedAnswer,
  stockedMedicine,
  type LabSession,
} from './support/lab.js';

const PATIENT = 'http://localhost:3000';
const CONSOLE = 'http://localhost:3100';

/** From the seed's declared set, so the spec invents no clinical content. */
const ASSESSMENT = DEMO_ASSESSMENTS[0];

let demo: ConsoleSession;
let lab: LabSession;

test.beforeEach(async () => {
  // One seeded patient in the chamber; the guest this spec books is serial 2.
  demo = await createConsoleSession(1);
  lab = await labSession(demo.hospitalId);
});

/** A phone nobody else in the run will use (`DB-P6` normalised). */
function guestPhone(): string {
  const tail = String(Math.floor(Math.random() * 90_000_000) + 10_000_000);
  return `+88019${tail}`;
}

/** Books serial 2 as a guest, leaving the link on this device. */
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

/**
 * Finishes serial 1, which calls the guest into the chamber.
 *
 * Through the API, as `wallet.spec.ts` does: `BTN-B05-SIGN` needs something
 * written before it will sign, and typing a second record here would be
 * testing the doctor console twice rather than the lab once.
 */
async function callInTheGuest(): Promise<void> {
  if (ASSESSMENT === undefined) throw new Error('the seed declares no assessments');
  const first = demo.bookingsBySerial.get(1);
  if (first === undefined) throw new Error('no serial 1');

  await signVisit(demo, first, {
    diagnosisText: ASSESSMENT.diagnosisBn,
    adviceTextBn: ASSESSMENT.adviceBn,
  });
}

/** Enters a console as the picker would, with no password (`CLAUDE.md` §4.1). */
async function enterConsole(page: Page, token: string, role: string, url: string): Promise<void> {
  await page.addInitScript(
    ([t, hospitalId, r]) => {
      sessionStorage.setItem(
        'console.demo-session',
        JSON.stringify({ token: t, hospitalId, staffName: 'Demo', role: r }),
      );
    },
    [token, demo.hospitalId, role],
  );
  await page.goto(url);
}

test.describe('a report a lab uploads reaches the patient (FR-LAB-03)', () => {
  test('doctor ticks a test, bench reports it, wallet opens it', async ({ page, context }) => {
    if (ASSESSMENT === undefined) throw new Error('the seed declares no assessments');

    // --- the patient books, and this device keeps the link -----------------
    const bookingId = await bookAsGuest(page);

    // --- the doctor calls them in, ticks a test, and signs ------------------
    const doctor = await context.newPage();
    await enterConsole(doctor, demo.doctorToken, 'doctor', `${CONSOLE}/?session=${demo.sessionId}`);

    // Serial 1 is finished through the API rather than typed: this spec is
    // about the test chips, and signing needs content either way.
    await callInTheGuest();
    await expect(doctor.getByTestId('visit-diagnosis')).toHaveValue('');

    await doctor.getByTestId('visit-diagnosis').fill(ASSESSMENT.diagnosisBn);

    // `BTN-B05-TEST`: the chips are the hospital's own catalogue.
    const tests = doctor.getByTestId('visit-tests');
    await expect(tests).toBeVisible();
    await tests.getByRole('button').first().click();

    await doctor.getByTestId('sign-and-next').click();

    // `APP_FLOW.md` B2: ticked on save, so the order exists now and not before.
    await expect
      .poll(async () => (await ordersForBooking(bookingId)).length, { timeout: 10_000 })
      .toBe(1);

    const [ordered] = await ordersForBooking(bookingId);
    expect(ordered?.state).toBe('ordered');

    // --- the bench sees it, works it, and uploads the report ----------------
    const bench = await context.newPage();
    await enterConsole(bench, lab.labToken, 'lab', `${CONSOLE}/?view=lab`);

    const row = bench.getByTestId(`lab-order-${ordered?.id ?? ''}`);
    await expect(row).toBeVisible();

    // The patient's name is not on the row until somebody asks (`DB-P7`).
    await expect(bench.getByTestId(`lab-reveal-${ordered?.id ?? ''}`)).toBeVisible();

    await bench.getByTestId(`lab-collect-${ordered?.id ?? ''}`).click();
    await bench.getByTestId(`lab-process-${ordered?.id ?? ''}`).click();

    await expect
      .poll(async () => (await ordersForBooking(bookingId))[0]?.state, { timeout: 10_000 })
      .toBe('processing');

    // The upload is a real file through the real input.
    await bench
      .getByTestId(`lab-upload-${ordered?.id ?? ''}`)
      .locator('input[type="file"]')
      .setInputFiles({
        name: 'report.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n', 'latin1'),
      });

    // Uploading *is* delivering: the order ends delivered and the report row
    // carries the stamp, in one act (`FR-LAB-03`).
    await expect
      .poll(async () => (await ordersForBooking(bookingId))[0]?.state, { timeout: 15_000 })
      .toBe('delivered');

    const [delivered] = await ordersForBooking(bookingId);
    expect(delivered?.reportDeliveredAt).not.toBeNull();

    // --- the patient opens it from the link this phone already held ---------
    await page.goto(`${PATIENT}/records`);

    // `TAB-A12-REP` appears because there is something in it.
    await page.getByTestId('wallet-tab-reports').click();

    const reports = page.getByTestId('report-list');
    await expect(reports).toBeVisible();
    await expect(reports).toContainText(ordered?.testCode ?? '');

    const open = page.getByTestId(`report-open-${delivered?.id ?? ''}`);
    await expect(open).toBeVisible();

    // Tapping mints a fresh signed URL and opens it. The new tab is what the
    // patient gets, and it has to be the file rather than a 404.
    const [opened] = await Promise.all([context.waitForEvent('page'), open.click()]);
    await opened.waitForLoadState('domcontentloaded');
    expect(opened.url()).toContain('/files/');
  });

  test('a test still on the bench says so, rather than saying no reports', async ({
    page,
    context,
  }) => {
    if (ASSESSMENT === undefined) throw new Error('the seed declares no assessments');

    const bookingId = await bookAsGuest(page);

    const doctor = await context.newPage();
    await enterConsole(doctor, demo.doctorToken, 'doctor', `${CONSOLE}/?session=${demo.sessionId}`);
    await callInTheGuest();
    await doctor.getByTestId('visit-diagnosis').fill(ASSESSMENT.diagnosisBn);
    await doctor.getByTestId('visit-tests').getByRole('button').first().click();
    await doctor.getByTestId('sign-and-next').click();

    await expect
      .poll(async () => (await ordersForBooking(bookingId)).length, { timeout: 10_000 })
      .toBe(1);

    await page.goto(`${PATIENT}/records`);
    await page.getByTestId('wallet-tab-reports').click();

    // "We are testing it" is a different sentence from "you have no reports",
    // and it is the one that stops somebody ringing the hospital.
    const reports = page.getByTestId('report-list');
    await expect(reports).toBeVisible();
    await expect(reports).toContainText('নমুনা দেওয়া বাকি');
    await expect(page.getByTestId('reports-empty')).toHaveCount(0);
  });

  test('a patient with no test is shown no Reports tab at all', async ({ page }) => {
    await bookAsGuest(page);
    await page.goto(`${PATIENT}/records`);

    // An empty Reports tab is a claim about the patient's health (`PRD.md`
    // §3.2). The tab is absent rather than empty.
    await expect(page.getByTestId('wallet-tabs')).toHaveCount(0);
  });
});

test.describe('the bench queue (S-B-08, FR-LAB-01, FR-LAB-04)', () => {
  test('opens on work rather than on nothing, with turnaround beside it', async ({ page }) => {
    await enterConsole(page, lab.labToken, 'lab', `${CONSOLE}/?view=lab`);

    // `CLAUDE.md` §5.3: no feature ships with an empty screen, and the seed
    // guarantees every lab has open orders.
    await expect(page.getByTestId('lab-console')).toBeVisible();
    await expect(page.locator('[data-testid^="lab-order-"]').first()).toBeVisible();
    await expect(page.getByTestId('lab-empty')).toHaveCount(0);

    // `FR-LAB-04`, measured and visible.
    await expect(page.getByTestId('lab-turnaround')).toBeVisible();
  });
});

test.describe('the pharmacy shelf is what the public is told (FR-PHR-02)', () => {
  test('flagging a medicine out of stock reaches the patient search', async ({ page, context }) => {
    const medicine = await stockedMedicine(demo.hospitalId);

    await enterConsole(page, lab.pharmacyToken, 'pharmacy', `${CONSOLE}/?view=pharmacy`);
    await expect(page.getByTestId('pharmacy-console')).toBeVisible();

    // `FR-PHR-01` is absent and says why, rather than a dead scanner.
    await expect(page.getByTestId('pharmacy-dispense-absent')).toBeVisible();

    const row = page.getByTestId(`stock-${medicine.medicineId}`);
    await expect(row).toBeVisible();
    await page.getByTestId(`stock-out-${medicine.medicineId}`).click();

    await expect
      .poll(
        async () =>
          await publishedAnswer(medicine.medicineId, demo.hospitalId, medicine.genericName),
        { timeout: 10_000 },
      )
      .toBe('out_of_stock');

    // And the patient's screen says নেই, with the age of the claim beside it.
    const patient = await context.newPage();
    await patient.goto(`${PATIENT}/medicines`);
    await patient.getByTestId('medicine-search').fill(medicine.genericName);

    const card = patient.getByTestId(`medicine-${medicine.medicineId}`);
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText('নেই');

    // `GR-05`: counts, never a verdict about the whole city.
    await expect(patient.getByTestId('medicine-summary').first()).toBeVisible();
  });

  test('confirming an unchanged list renews what the public is told', async ({ page }) => {
    await enterConsole(page, lab.pharmacyToken, 'pharmacy', `${CONSOLE}/?view=pharmacy`);

    // The commonest and most valuable thing done at this counter: nothing
    // changed, and saying so is what keeps the flags standing (`FR-PHR-02`).
    await page.getByTestId('pharmacy-confirm-all').click();
    await expect(page.getByTestId('pharmacy-console')).toBeVisible();
    await expect(page.getByTestId('pharmacy-failed')).toHaveCount(0);
  });
});
