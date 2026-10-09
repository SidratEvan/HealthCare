/**
 * `e2e/app-shell.spec.ts` — the app shell (`APP_FLOW.md` S-A-02, `NAV-A`).
 *
 * The owner's complaint was that the patient side "does not look anything like
 * an app", and the answer was structural rather than cosmetic: four tabs that
 * are always there, a home screen composed in the documented order, and a
 * serials tab that knows what this phone booked. This spec covers the part of
 * that a unit test cannot — that the navigation navigates, that every tab lands
 * somewhere real, and that a booking made on one screen appears on another.
 *
 * ## Why the tabs that are not built are tested too
 *
 * A four-item bar where two items are months away is a deliberate decision
 * (`TabScreen.tsx` says why), and what makes it honest rather than broken is
 * the screen behind them. A dead link would be the bug, so what is asserted is
 * that each tab arrives somewhere that explains itself.
 */

import { expect, test, type Page } from '@playwright/test';

import { createConsoleSession, type ConsoleSession } from './support/console.js';

const PATIENT = 'http://localhost:3000';

let demo: ConsoleSession;

test.beforeEach(async () => {
  demo = await createConsoleSession(3);
});

/** A phone nobody else in the run will use (`DB-P6` normalised). */
function guestPhone(): string {
  const tail = String(Math.floor(Math.random() * 90_000_000) + 10_000_000);
  return `+88019${tail}`;
}

test.describe('S-A-02 Home', () => {
  test('puts emergency first, above the fold', async ({ page }) => {
    await page.goto(PATIENT);

    // `FRONTEND.md` §6.3: "never A/B tested for conversions; never moved below
    // the fold". Somebody opening this in an emergency has seconds.
    const emergency = page.getByTestId('emergency-card');
    await expect(emergency).toBeVisible();
    await expect(emergency).toBeInViewport();

    // Then the way to ask, and the three main actions (Visual Direction 2).
    await expect(page.getByTestId('home-search')).toBeVisible();
    await expect(page.getByTestId('home-find-doctor')).toBeInViewport();
    await expect(page.getByTestId('home-my-serial')).toBeInViewport();
  });

  test('a specialty answers with its doctors and, a tap away, the hospitals offering it', async ({
    page,
  }) => {
    // The specialties moved from Home to the search screen on 2026-10-07
    // (APP_FLOW.md S-A-02); `S-A-07s` shows doctors first for a specialty and
    // the hospitals offering it on the other side of the switch.
    await page.goto(PATIENT);
    await page.getByTestId('home-find-doctor').click();
    await page.getByTestId(`need-specialty:${demo.departmentCode}`).click();

    await expect(page.locator('[data-testid^="result-doctor-"]').first()).toBeVisible();
    await page.getByTestId('search-tab-hospitals').click();
    await expect(page.getByTestId(`result-hospital-${demo.hospitalId}`)).toBeVisible();
  });

  test('a live figure on the hospital list says how old it is (FR-PAT-14)', async ({ page }) => {
    await page.goto(`${PATIENT}/book?specialty=${demo.departmentCode}`);

    // "Who is sitting now" is live, and a live number with no age is the one
    // thing this product does not show (`FR-OFF-03`).
    await expect(page.getByTestId('freshness').first()).toBeVisible();
  });
});

test.describe('NAV-A the bottom navigation', () => {
  test('carries five labelled tabs', async ({ page }) => {
    await page.goto(PATIENT);

    const nav = page.getByTestId('bottom-nav');
    await expect(nav).toBeVisible();

    // `ICO-03`: the label carries the meaning. An icon alone is not reliably
    // decoded by the older users this product is largely for, so the words stay
    // on screen rather than appearing only on the active tab.
    for (const label of ['হোম', 'খুঁজুন', 'সিরিয়াল', 'রেকর্ড', 'আরও']) {
      await expect(nav.getByText(label)).toBeVisible();
    }
  });

  test('marks the current tab as current, not merely coloured (A11Y-03)', async ({ page }) => {
    await page.goto(`${PATIENT}/serials`);

    // Colour never carries meaning alone, so the state sits in the
    // accessibility tree where a screen reader can reach it.
    await expect(page.getByTestId('nav-serials')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('nav-records')).not.toHaveAttribute('aria-current', 'page');
  });

  test('every tab lands somewhere that explains itself', async ({ page }) => {
    await page.goto(PATIENT);

    for (const tab of ['search', 'serials', 'records', 'profile']) {
      await page.getByTestId(`nav-${tab}`).click();
      await expect(page).toHaveURL(new RegExp(`/${tab}$`));

      // Either the real screen or an honest "not built yet" — never a blank,
      // never a dead link (`GR-03`).
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

      await page.getByTestId('nav-home').click();
    }
  });

  test('the Profile tab offers sign-in, and says booking never needs it (FR-GST-01)', async ({
    page,
  }) => {
    // Profile was the "not built yet" tab until pilot step 25 gave patients a
    // phone sign-in; `patient-account.spec.ts` walks the rest of it.
    await page.goto(`${PATIENT}/profile`);
    await expect(page.getByTestId('signin-phone')).toBeVisible();
    await expect(page.getByTestId('signin-phone')).toContainText('বুকিংয়ের জন্য লগ ইন লাগে না');
    await expect(page.getByTestId('not-built')).toHaveCount(0);
  });

  test('everything on the first screen leads somewhere that works (S-A-02, PRD §7.8)', async ({
    page,
  }) => {
    // Ambulance and blood were tiles that led to "not built yet". They are
    // outside V1, so they are not offered: not on Home, not on the emergency
    // screens.
    await page.goto(PATIENT);
    await expect(page.getByTestId('emergency-card')).toBeVisible();
    await expect(page.locator('a[href="/ambulance"], a[href="/blood"]')).toHaveCount(0);

    await page.goto(`${PATIENT}/emergency`);
    await expect(page.getByTestId('call-999')).toBeVisible();
    await expect(page.locator('a[href="/ambulance"]')).toHaveCount(0);

    await page.goto(`${PATIENT}/beds`);
    await expect(page.getByTestId('bed-search')).toBeVisible();
  });
});

test.describe('what this version does not have yet, honestly', () => {
  test('the emergency card opens triage, with 999 first (S-A-10, BTN-A10-999, FR-PAT-41)', async ({
    page,
  }) => {
    await page.goto(PATIENT);
    await page.getByTestId('emergency-card').click();

    // The call is first and needs nothing — no login, no phone number (`GR-08`).
    const call = page.getByTestId('call-999');
    await expect(call).toBeVisible();
    await expect(call).toHaveAttribute('href', 'tel:999');

    // Then the split: critical goes straight to the nearest ER, urgent asks
    // what happened (step 15; the owner's ruling of 2026-09-21).
    await expect(page.getByTestId('emergency-critical')).toBeVisible();
    await page.getByTestId('emergency-urgent').click();
    await expect(page.getByTestId('problem-burn')).toBeVisible();
    await expect(page.getByTestId('not-built')).toHaveCount(0);
  });

  test('a failed list says so instead of claiming nothing exists (GR-03)', async ({ page }) => {
    // `PRD.md` §3.2: degrade honestly. "No hospital offers this department" is a
    // statement about the world; a request that failed is a statement about us,
    // and the two must not share their words.
    await page.route('**/hospitals?specialty=*', (route) => route.abort());
    await page.goto(`${PATIENT}/book?specialty=${demo.departmentCode}`);

    await expect(page.getByTestId('load-failed')).toBeVisible();
    await expect(page.getByText('কোনো হাসপাতাল পাওয়া যায়নি', { exact: false })).toHaveCount(0);
  });
});

test.describe('S-A-09 My serials', () => {
  test('says plainly when this phone has booked nothing', async ({ page }) => {
    await page.goto(`${PATIENT}/serials`);

    // `GR-03`: empty is a designed state, and this one names the way out.
    await expect(page.getByTestId('serials-empty')).toBeVisible();
  });

  test('lists a serial this device booked, and the home strip shows it', async ({ page }) => {
    await book(page);

    // There are no accounts (`CLAUDE.md` §4.1), so what this proves is the
    // device-local record — and that the screen admits as much rather than
    // implying it holds somebody's whole history.
    await page.goto(`${PATIENT}/serials`);
    await expect(page.getByTestId('serials-empty')).toHaveCount(0);
    await expect(page.getByText('এই ফোনে নেওয়া সিরিয়াল', { exact: false })).toBeVisible();
    await expect(page.getByTestId(/^serial-/).first()).toBeVisible();

    // `BTN-A02-ACTIVE`: "appears only if an active booking exists today".
    await page.goto(PATIENT);
    const strip = page.getByTestId('active-serial');
    await expect(strip).toBeVisible();

    // And it opens the live screen rather than restating the number.
    await strip.click();
    await expect(page).toHaveURL(/\/s\?/);
  });
});

/**
 * Books a serial through the screens, leaving the device's record behind.
 *
 * The record is the point: `rememberBooking` is what `S-A-09` and the home
 * strip both read, and the success step writes it — so only a booking that went
 * through the UI proves it works.
 */
async function book(page: Page): Promise<void> {
  await page.goto(`${PATIENT}/book?specialty=${demo.departmentCode}`);

  await page.getByTestId(`hospital-${demo.hospitalId}`).click();
  await page.getByTestId(`doctor-${demo.doctorId}`).click();
  await page.getByTestId(`session-${demo.sessionId}`).click();

  await page.getByLabel('রোগীর নাম').fill('রহিমা খাতুন');
  await page.getByLabel('মোবাইল নম্বর').fill(guestPhone());
  await page.getByLabel('বয়স').fill('34');

  await page.getByRole('button', { name: 'বিকাশ' }).click();
  await page.getByTestId('confirm-booking').click();

  await expect(page.getByTestId('booking-success')).toBeVisible();
}
