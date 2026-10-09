/**
 * A serial is current until it is settled, whatever the date
 * (`PRD.md` `FR-PAT-39`, `FR-QUE-06`; founder's decision, 2026-10-05).
 *
 * Home's strip and My serials used to go by the calendar: a booking dated
 * today was live and one dated yesterday was past. A chamber that runs or is
 * paused past midnight breaks that — the patient still waiting at 00:01 lost
 * their serial from the first screen.
 *
 * A test cannot wait for midnight, and does not need to: the thing to prove
 * is that the date decides nothing. So the phone here holds a booking whose
 * date is *yesterday*, in a chamber that is in fact still running, with the
 * real tracking link for it. By the calendar it is past. By the server it is
 * current, and that is what the screens must say.
 */

import { expect, test, type Page } from '@playwright/test';

import { createConsoleSession, type ConsoleSession } from './support/console.js';
import { putReceptionistInTab } from './support/consoleSession.js';
import { issueTrackingLink } from './support/guestLink.js';

const PATIENT = 'http://localhost:3000';
const CONSOLE = 'http://localhost:3100';

let demo: ConsoleSession;
let bookingId: string;

test.beforeEach(async () => {
  // Serial 1 is in the chamber; the fixture's chamber is running.
  demo = await createConsoleSession(6);
  const first = demo.bookingsBySerial.get(1);
  if (first === undefined) throw new Error('The fixture has no serial 1.');
  bookingId = first;
});

/** Puts on the phone a booking for serial 1, dated yesterday, with its real link. */
async function holdYesterdaysBooking(page: Page): Promise<void> {
  const link = new URL(await issueTrackingLink(bookingId));
  const yesterday = new Date(Date.now() - 26 * 3_600_000).toISOString();

  await page.goto(PATIENT);
  await page.evaluate(
    ([id, sessionId, hospitalId, url, token, plannedStart]) => {
      globalThis.localStorage.setItem(
        'patient.bookings',
        JSON.stringify([
          {
            bookingId: id,
            serial: 1,
            sessionId,
            doctorNameBn: 'ডা. মধ্যরাত (ডেমো)',
            hospitalNameBn: 'হাসপাতাল (ডেমো)',
            hospitalId,
            plannedStart,
            url,
            token,
            savedAt: plannedStart,
          },
        ]),
      );
      globalThis.localStorage.removeItem('patient.bookings.standing');
    },
    [
      bookingId,
      demo.sessionId,
      demo.hospitalId,
      `${link.pathname}${link.search}`,
      link.searchParams.get('t') ?? '',
      yesterday,
    ],
  );
}

test.describe('a serial is current until it is settled, whatever the date (FR-PAT-39)', () => {
  test('a chamber dated yesterday and still running keeps its strip; being seen moves it to Past', async ({
    page,
    browser,
  }) => {
    await holdYesterdaysBooking(page);

    // Home: the strip is there, because the server says the serial is live.
    await page.goto(PATIENT);
    const strip = page.getByTestId('active-serial');
    await expect(strip).toBeVisible();
    await expect(strip).toHaveAttribute('data-standing', 'current');
    await expect(page.getByTestId('active-serial-unknown')).toHaveCount(0);

    // My serials: listed as current, not under past, though its date is yesterday.
    await page.goto(`${PATIENT}/serials`);
    await expect(
      page.getByTestId('serials-current').getByTestId(`serial-${bookingId}`),
    ).toBeVisible();
    await expect(page.getByTestId('serials-past')).toHaveCount(0);

    // Reception finishes that patient and calls the next.
    const counter = await browser.newContext();
    const reception = await counter.newPage();
    await putReceptionistInTab(reception, demo);
    await reception.goto(`${CONSOLE}/?session=${demo.sessionId}`);
    await expect(reception.getByTestId('now-serving')).toHaveText('১');
    await reception.getByTestId('call-next').click();
    await expect(reception.getByTestId('now-serving')).toHaveText('২');
    await counter.close();

    // Settled: the patient has been seen. The strip goes, and the booking is past.
    await page.goto(PATIENT);
    await expect(page.getByTestId('app-name')).toBeVisible();
    await expect(page.getByTestId('active-serial')).toHaveCount(0);
    await page.goto(`${PATIENT}/serials`);
    await expect(page.getByTestId('serials-past').getByTestId(`serial-${bookingId}`)).toBeVisible();
    await expect(page.getByTestId('serials-current')).toHaveCount(0);
  });

  test('a status that cannot be checked is unknown, with its age, and never past', async ({
    page,
  }) => {
    await holdYesterdaysBooking(page);

    // Asked once while the server can be reached, so the phone has an answer
    // to be the age of.
    await page.goto(PATIENT);
    await expect(page.getByTestId('active-serial')).toHaveAttribute('data-standing', 'current');

    // Now the server cannot be asked.
    await page.route('**/guest/link/**', async (route) => {
      await route.abort('failed');
    });

    await page.goto(PATIENT);
    const strip = page.getByTestId('active-serial');
    await expect(strip).toHaveAttribute('data-standing', 'unknown');
    await expect(page.getByTestId('active-serial-unknown')).toContainText('জানা যাচ্ছে না');
    await expect(page.getByTestId('active-serial-unknown')).toContainText('শেষ জানা');

    await page.goto(`${PATIENT}/serials`);
    const current = page.getByTestId('serials-current');
    await expect(current.getByTestId(`serial-${bookingId}`)).toBeVisible();
    await expect(page.getByTestId(`serial-unknown-${bookingId}`)).toContainText('জানা যাচ্ছে না');
    await expect(page.getByTestId('serials-past')).toHaveCount(0);
  });

  test('a booking the phone has never had an answer for is unknown, not past', async ({ page }) => {
    await page.route('**/guest/link/**', async (route) => {
      await route.abort('failed');
    });
    await holdYesterdaysBooking(page);

    await page.goto(`${PATIENT}/serials`);
    await expect(
      page.getByTestId('serials-current').getByTestId(`serial-${bookingId}`),
    ).toBeVisible();
    const note = page.getByTestId(`serial-unknown-${bookingId}`);
    await expect(note).toContainText('জানা যাচ্ছে না');
    // Nothing to be the age of.
    await expect(note).not.toContainText('শেষ জানা');
    await expect(page.getByTestId('serials-past')).toHaveCount(0);
  });
});
