/**
 * `e2e/two-device-queue.spec.ts` — **the product's canary** (CLAUDE.md §6).
 *
 * "Console taps next in one context, patient page in another updates in under
 * 2 s. It must never be skipped or marked flaky."
 *
 * This is the whole pitch in one file. CLAUDE.md §1: "reception taps *next*,
 * and every waiting patient's phone updates within two seconds. Everything
 * else supports it." If this file goes red, the product does not work — no
 * other test in the repository carries that meaning, which is why this one may
 * never be quarantined, retried around, or given a longer budget to hide a
 * regression.
 *
 * ## Two browser contexts, not two tabs
 *
 * A context is a separate browser profile: its own storage, its own cookies,
 * its own socket. A receptionist at a counter and a patient in a corridor are
 * two devices, and the thing being proven is that a fact entered on one
 * reaches the other — which two tabs sharing a process could fake through a
 * shared cache.
 *
 * ## Why the patient arrives by booking rather than by fixture
 *
 * `PRD.md` §24 step 1: "Patient books a cardiology serial and sees serial 18
 * with an estimated time." The route into this screen is the SMS tracking link
 * a real booking produces (`FR-GST-05`), so the spec takes that route. A
 * fixture that inserted a `guest_links` row would prove the screen renders
 * while leaving the path a hospital director is actually shown untested.
 */

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { createConsoleSession, queueAction, type ConsoleSession } from './support/console.js';

const PATIENT = 'http://localhost:3000';

/** `NFR-01`: reception tap → patient device, p95. The promise, in milliseconds. */
const LATENCY_BUDGET_MS = 2_000;

let demo: ConsoleSession;

test.beforeEach(async () => {
  // Its own session per test: `queue_events` is append-only, so a spec that
  // called three patients would leave the chamber in a state the next one did
  // not expect. That is the flakiness CLAUDE.md §6 calls a bug.
  demo = await createConsoleSession(8);
});

/** A phone nobody else in the run will use (`DB-P6` normalised). */
function guestPhone(): string {
  const tail = String(Math.floor(Math.random() * 90_000_000) + 10_000_000);
  return `+88019${tail}`;
}

/**
 * Books a serial as a guest and returns the tracking link the SMS carries.
 *
 * Walks the screens rather than posting to the API: what this proves is the
 * path a person takes, and a booking made behind the UI would not catch a
 * confirm button that stopped working.
 */
async function bookAndGetTrackingLink(page: Page): Promise<string> {
  await page.goto(`${PATIENT}/book?specialty=${demo.departmentCode}`);

  // Hospital, then doctor, then chamber — `APP_FLOW.md` A3's order.
  await page.getByTestId(`hospital-${demo.hospitalId}`).click();
  await page.getByTestId(`doctor-${demo.doctorId}`).click();
  await page.getByTestId(`session-${demo.sessionId}`).click();

  await page.getByLabel('রোগীর নাম').fill('রহিমা খাতুন');
  await page.getByLabel('মোবাইল নম্বর').fill(guestPhone());
  await page.getByLabel('বয়স').fill('34');
  await page.getByRole('button', { name: 'বিকাশ' }).click();
  await page.getByTestId('confirm-booking').click();

  await expect(page.getByTestId('booking-success')).toBeVisible();

  const href = await page.getByTestId('tracking-link').getAttribute('href');
  if (href === null) throw new Error('the success screen issued no tracking link');
  return href;
}

/** Opens the console with a principal in place — `DEMO_MODE`'s stand-in for a login. */
async function openConsole(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();

  // The same store `ConsolePicker` writes, so a spec and a person reach the
  // console the same way — one credential, one key (CLAUDE.md §4.1).
  await page.addInitScript((token: string) => {
    window.sessionStorage.setItem(
      'console.demo-session',
      JSON.stringify({ token, hospitalId: 'e2e', staffName: 'E2E' }),
    );
  }, demo.token);

  await page.goto(`http://localhost:3100/?session=${demo.sessionId}`);
  await expect(page.getByTestId('queue-table')).toBeVisible();
  return page;
}

/** Opens the patient's live serial from an SMS link, on its own device. */
async function openLiveSerial(context: BrowserContext, trackingUrl: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(trackingUrl);
  await expect(page.getByTestId('live-serial')).toBeVisible();
  return page;
}

test.describe('the two-device queue — the product', () => {
  test('a reception tap reaches the patient in under two seconds (NFR-01, FR-PAT-31)', async ({
    browser,
  }) => {
    // Two contexts: two devices, two sockets, nothing shared.
    const counter = await browser.newContext();
    const corridor = await browser.newContext();

    try {
      const bookingPage = await corridor.newPage();
      const trackingUrl = await bookAndGetTrackingLink(bookingPage);
      await bookingPage.close();

      const patient = await openLiveSerial(corridor, trackingUrl);
      const console_ = await openConsole(counter);

      // Serial 1 is in the chamber when the fixture opens.
      await expect(patient.getByTestId('now-serving')).toHaveText('১');

      // The measurement starts the instant the tap lands and stops when the
      // patient's own device shows the new number. Nothing in between is
      // mocked: a real socket, a real reducer, a real database write.
      const startedAt = Date.now();
      await console_.getByTestId('call-next').click();

      await expect(patient.getByTestId('now-serving')).toHaveText('২', {
        timeout: LATENCY_BUDGET_MS,
      });

      const elapsed = Date.now() - startedAt;
      expect(
        elapsed,
        `The patient's phone took ${String(elapsed)} ms. NFR-01 allows ${String(LATENCY_BUDGET_MS)} ms.`,
      ).toBeLessThan(LATENCY_BUDGET_MS);
    } finally {
      await counter.close();
      await corridor.close();
    }
  });

  test('the queue keeps moving, tap after tap (PRD.md §24 step 4)', async ({ browser }) => {
    const counter = await browser.newContext();
    const corridor = await browser.newContext();

    try {
      const bookingPage = await corridor.newPage();
      const trackingUrl = await bookAndGetTrackingLink(bookingPage);
      await bookingPage.close();

      const patient = await openLiveSerial(corridor, trackingUrl);
      const console_ = await openConsole(counter);

      // "Reception calls next three times; the patient's position and ETA move
      // in real time." One tap arriving is a socket working; three arriving in
      // order is the queue working.
      for (const expected of ['২', '৩', '৪']) {
        await console_.getByTestId('call-next').click();
        await expect(patient.getByTestId('now-serving')).toHaveText(expected, {
          timeout: LATENCY_BUDGET_MS,
        });
      }
    } finally {
      await counter.close();
      await corridor.close();
    }
  });

  test('a declared delay reaches the patient (PRD.md §24 step 3, FR-PAT-34)', async ({
    browser,
  }) => {
    const corridor = await browser.newContext();

    try {
      const bookingPage = await corridor.newPage();
      const trackingUrl = await bookAndGetTrackingLink(bookingPage);
      await bookingPage.close();

      const patient = await openLiveSerial(corridor, trackingUrl);

      // The fixture's doctor arrived twenty minutes ago, so the status line
      // already says so — which is what a patient opening the link mid-session
      // must see rather than a blank.
      await expect(patient.getByTestId('live-serial-status')).toContainText('ডাক্তার');

      // Raised through the endpoint rather than the console: `BTN-B02-DELAY`
      // is named in `APP_FLOW.md` B1.2 but was not built in step 8, and what
      // this asserts is the *patient* half — that the broadcast lands, shifts
      // the surface to the warn family, and states the new number of minutes.
      await queueAction(demo, `/sessions/${demo.sessionId}/delay`, {
        minutes: 30,
        reason: null,
        declaredBy: 'reception',
      });

      await expect(patient.getByTestId('live-serial')).toHaveAttribute('data-tone', 'delayed', {
        timeout: LATENCY_BUDGET_MS,
      });
      await expect(patient.getByTestId('live-serial-status')).toContainText('৩০');
    } finally {
      await corridor.close();
    }
  });

  test('the number never appears without saying how old it is (FR-PAT-35, GR-05)', async ({
    browser,
  }) => {
    const corridor = await browser.newContext();

    try {
      const bookingPage = await corridor.newPage();
      const trackingUrl = await bookAndGetTrackingLink(bookingPage);
      await bookingPage.close();

      const patient = await openLiveSerial(corridor, trackingUrl);

      // `PRD.md` §3.2: never show a live number without its age. On the screen
      // whose entire claim is that its number is true right now, this is the
      // line that makes the claim checkable.
      const freshness = patient.getByTestId('freshness');
      await expect(freshness).toBeVisible();
      await expect(freshness).toHaveAttribute('data-stale', 'false');
    } finally {
      await corridor.close();
    }
  });

  test('losing the network says so instead of showing a confident number (FR-PAT-36)', async ({
    browser,
  }) => {
    const corridor = await browser.newContext();

    try {
      const bookingPage = await corridor.newPage();
      const trackingUrl = await bookAndGetTrackingLink(bookingPage);
      await bookingPage.close();

      const patient = await openLiveSerial(corridor, trackingUrl);
      await expect(patient.getByTestId('live-serial')).toHaveAttribute('data-stale', 'false');

      await corridor.setOffline(true);

      // The card stays. A number that has stopped updating, labelled as such,
      // is more use to somebody standing in a corridor than a blank screen.
      await expect(patient.getByTestId('live-serial-disconnected')).toBeVisible();
      await expect(patient.getByTestId('live-serial-number')).toBeVisible();
      await expect(patient.getByTestId('live-dot')).toHaveAttribute('data-live', 'false');

      // And it recovers on its own; nobody should have to reload.
      await corridor.setOffline(false);
      await expect(patient.getByTestId('live-serial')).toHaveAttribute('data-stale', 'false', {
        timeout: 20_000,
      });
    } finally {
      await corridor.close();
    }
  });
});
