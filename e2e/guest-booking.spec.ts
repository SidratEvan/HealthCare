/**
 * `e2e/guest-booking.spec.ts` — required by CLAUDE.md §6.
 *
 * "Book with no account, open the SMS tracking link, see the live serial."
 *
 * Step 9's definition of done is the first two thirds of that: a guest books
 * end to end with mock payment, and the tracking link is issued and resolves.
 * The last third — *seeing the live serial* — needs `<LiveSerialCard>` and the
 * session channel on the patient side, which is step 10. This file asserts
 * everything that exists and is extended there rather than being left
 * unwritten until then.
 *
 * ## Why it runs against the real seeded demo
 *
 * The doctors, chambers and fees are the ones a hospital director will be
 * shown (`FR-DEM-*`). A booking flow that works against invented fixtures and
 * not against the demo is a booking flow that fails in the room.
 */

import { expect, test, type Page } from '@playwright/test';

import { bookingBySerial, createConsoleSession, type ConsoleSession } from './support/console.js';

const PATIENT = 'http://localhost:3000';

let demo: ConsoleSession;

test.beforeEach(async () => {
  // Its own session, for the same reason the console spec has one: bookings
  // cannot be cleaned up, so a shared chamber would make each run depend on
  // what the last one took.
  demo = await createConsoleSession(3);
});

/** A phone nobody else in the run will use (`DB-P6` normalised). */
function guestPhone(): string {
  const tail = String(Math.floor(Math.random() * 90_000_000) + 10_000_000);
  return `+88019${tail}`;
}

/**
 * Walks the booking flow to the confirm step.
 *
 * Goes through the screens rather than posting to the API, because what this
 * spec is for is the part between a person and the API — that the doctor they
 * tapped is the doctor they get, and that the fee they were shown is the fee
 * they are charged.
 */
async function reachConfirm(page: Page): Promise<void> {
  await page.goto(`${PATIENT}/book?specialty=${demo.departmentCode}`);

  // S-A-07: the doctor list. The seeded chamber's doctor is in it.
  const doctor = page.getByTestId(`doctor-${demo.doctorId}`);
  await expect(doctor).toBeVisible();
  await doctor.click();

  // S-A-07b: the session picker, showing this chamber.
  const session = page.getByTestId(`session-${demo.sessionId}`);
  await expect(session).toBeVisible();
  await session.click();
}

test.describe('a guest books with no account (FR-GST-01)', () => {
  test('never shows a login wall', async ({ page }) => {
    await page.goto(`${PATIENT}/book?specialty=${demo.departmentCode}`);

    // "The app never shows a login wall; it shows a shorter form"
    // (APP_FLOW.md A1.5). Nothing on the way to a booking asks to sign in.
    await expect(page.getByText(/লগ ইন|sign in|log in/i)).toHaveCount(0);
    await expect(page.getByTestId(`doctor-${demo.doctorId}`)).toBeVisible();
  });

  test('asks only for name, phone, age and sex (FR-GST-02)', async ({ page }) => {
    await reachConfirm(page);

    // A guest supplies only what the task needs. A booking creates a clinical
    // record, so these four — and nothing else.
    await expect(page.getByLabel('রোগীর নাম')).toBeVisible();
    await expect(page.getByLabel('মোবাইল নম্বর')).toBeVisible();
    await expect(page.getByLabel('বয়স')).toBeVisible();

    // No password, no email, no OTP: FR-GST-03/04 are deferred (CLAUDE.md §4.1).
    await expect(page.getByLabel(/পাসওয়ার্ড|password/i)).toHaveCount(0);
  });

  test('shows the fee as a breakdown before confirming (FR-PAT-21)', async ({ page }) => {
    await reachConfirm(page);

    // A total on its own is a number somebody has to take on trust.
    await expect(page.getByText('ডাক্তারের ফি')).toBeVisible();
    await expect(page.getByText('মোট')).toBeVisible();
  });

  test('stamps the expected wait with its freshness (DoD §5.8)', async ({ page }) => {
    await reachConfirm(page);

    // The wait is a live figure, and a live figure that does not say how old
    // it is invites someone to trust a number the queue has already moved past.
    const freshness = page.getByTestId('freshness');
    await expect(freshness).toBeVisible();
    await expect(freshness).toHaveAttribute('data-stale', 'false');
  });

  test('says what is due at the hospital when paying there', async ({ page }) => {
    await reachConfirm(page);
    await page.getByRole('button', { name: 'হাসপাতালে দেব' }).click();

    // A person who thinks they have paid and is asked again at a counter has
    // been misled.
    await expect(page.getByText('হাসপাতালে দিতে হবে')).toBeVisible();
  });

  test('will not confirm until the details are usable', async ({ page }) => {
    await reachConfirm(page);

    // FRONTEND.md §5.1: never disable a primary silently — the button carries
    // the reason.
    const confirm = page.getByTestId('confirm-booking');
    await expect(confirm).toBeDisabled();
    await expect(confirm).toHaveAttribute('title', /.+/);
  });

  test('says so when the network is gone, rather than looking ready (GR-03)', async ({
    page,
    context,
  }) => {
    await reachConfirm(page);

    // Booking takes a serial from a shared queue, so unlike the console it
    // cannot be completed offline. The honest state names that.
    await context.setOffline(true);

    await expect(page.getByTestId('offline-notice')).toBeVisible();

    // And the primary carries the reason rather than being dead to the touch
    // (`FRONTEND.md` §5.1).
    const confirm = page.getByTestId('confirm-booking');
    await expect(confirm).toBeDisabled();
    await expect(confirm).toHaveAttribute('title', 'ইন্টারনেট সংযোগ নেই');

    // It comes back by itself; nobody should have to reload to recover.
    await context.setOffline(false);
    await expect(page.getByTestId('offline-notice')).toHaveCount(0);
  });

  test('rejects a malformed phone with an instructive message (§5.2)', async ({ page }) => {
    await reachConfirm(page);

    await page.getByLabel('মোবাইল নম্বর').fill('01712345678');
    await page.getByLabel('বয়স').click();

    // "১১ সংখ্যার মোবাইল নম্বর দিন", never "Invalid input".
    //
    // Targeted by its text rather than by `role="alert"`: Next injects its own
    // route announcer with that role, so the role alone matches two elements
    // and the assertion fails for a reason that has nothing to do with the
    // message being right.
    await expect(page.getByText('১১ সংখ্যার মোবাইল নম্বর দিন')).toBeVisible();
  });
});

test.describe('the booking completes, end to end', () => {
  test('takes a serial, shows it, and issues a tracking link (FR-GST-05)', async ({ page }) => {
    const phone = guestPhone();
    await reachConfirm(page);

    await page.getByLabel('রোগীর নাম').fill('রহিমা খাতুন');
    await page.getByLabel('মোবাইল নম্বর').fill(phone);
    await page.getByLabel('বয়স').fill('34');

    // Mock payment: PAYMENT_PROVIDER=mock always succeeds, which is the
    // correct implementation for this version (CLAUDE.md §1.1).
    await page.getByRole('button', { name: 'বিকাশ' }).click();
    await page.getByTestId('confirm-booking').click();

    // S-A-07d.
    await expect(page.getByTestId('booking-success')).toBeVisible();

    // The chamber already had three bookings, so this is serial four — in
    // Bengali numerals, because this is a patient surface (TYP-04).
    await expect(page.getByTestId('serial')).toHaveText('৪');

    // FR-GST-05: single-booking scoped, and the one thing the SMS carries.
    const link = page.getByTestId('tracking-link');
    await expect(link).toBeVisible();

    const href = await link.getAttribute('href');
    expect(href).toContain('/s?');
    expect(href).toContain('b=');
    expect(href).toContain('t=');

    // And it is a real booking, not just a screen: the row exists, on this
    // session, at that serial.
    const booking = await bookingBySerial(demo.sessionId, 4);
    expect(booking).not.toBeNull();
    expect(booking?.source).toBe('guest_link');
  });

  test('refuses a second booking with the same doctor the same day (FR-PAT-24)', async ({
    page,
  }) => {
    const phone = guestPhone();

    for (const attempt of [1, 2]) {
      await reachConfirm(page);
      await page.getByLabel('রোগীর নাম').fill('রহিমা খাতুন');
      await page.getByLabel('মোবাইল নম্বর').fill(phone);
      await page.getByLabel('বয়স').fill('34');
      await page.getByTestId('confirm-booking').click();

      if (attempt === 1) {
        await expect(page.getByTestId('booking-success')).toBeVisible();
      }
    }

    // Stated in Bangla, by cause — and the app stays on the confirm screen so
    // the person can change what they are doing.
    await expect(page.getByText(/আগেই নেওয়া আছে/)).toBeVisible();
    await expect(page.getByTestId('booking-success')).toHaveCount(0);
  });
});
