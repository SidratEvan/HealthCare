/**
 * `e2e/production/two-device-queue.prod.spec.ts` — the product's one promise,
 * against what a hospital runs (`docs/PLATFORM_PLAN.md` 1.8).
 *
 * `e2e/two-device-queue.spec.ts` is the canary: reception taps *next* and the
 * patient's phone shows it within two seconds (`NFR-01`, `FR-PAT-31`). It runs
 * against the demonstration — `next dev`, `DEMO_MODE=true`, the API connected
 * as the database's owner — and until this file existed that was the only
 * place the promise had ever been checked. This is the same promise and the
 * same two seconds against the production configuration
 * (`playwright.prod.config.ts`): the API with `NODE_ENV=production` and
 * `DEMO_MODE=false`, connected as the role that owns nothing, and both apps as
 * built.
 *
 * ## Two things are done differently here, and neither is a shortcut
 *
 * **The receptionist signs in.** With the demonstration off there is no
 * password-less picker (`CLAUDE.md` §4.1), so this is the real `S-B-00`: an
 * email, a password, and only that person's facility afterwards.
 *
 * **The patient's link is written by a fixture, not obtained by booking.**
 * Under this configuration a guest proves their phone with a code before
 * booking (`FR-GST-03`), the code travels by SMS, and no SMS provider exists
 * (`docs/STATUS.md`, the first blocker). A patient therefore cannot book
 * through the app here at all. That is a fact about the product today, and
 * this spec does not paper over it: the link below is the row an SMS would
 * have pointed at (`support/guestLink.ts`), and everything from opening it
 * onward is the product. When an SMS provider exists this spec should book
 * through the app, as the canary does.
 *
 * The threshold is the canary's and is not this file's to change.
 */

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { createConsoleSession, type ConsoleSession } from '../support/console.js';
import { issueTrackingLink } from '../support/guestLink.js';
import { DEMO_PASSWORD, seededReceptionistAt } from '../support/staff.js';

const CONSOLE = 'http://localhost:3100';
const API = 'http://localhost:4000';

/** `NFR-01`, `FR-PAT-31`. The same figure as `e2e/two-device-queue.spec.ts`. */
const LATENCY_BUDGET_MS = 2_000;

/** The start of `demoBanner`, the line only a demonstration may carry. */
const DEMONSTRATION_LINE = 'এটি একটি ডেমো';

let demo: ConsoleSession;

test.beforeEach(async () => {
  // Eight serials and serial 1 in the chamber; the patient holds serial 5.
  demo = await createConsoleSession(8);
});

/** `S-B-00`, then the chamber: the way a receptionist's morning starts. */
async function signInAndOpenChamber(context: BrowserContext): Promise<Page> {
  const reception = await seededReceptionistAt(demo.hospitalId);
  const page = await context.newPage();

  await page.goto(CONSOLE);
  // No picker to walk past: with the demonstration off the console opens on
  // the sign-in.
  await expect(page.getByTestId('staff-login')).toBeVisible();
  await page.getByTestId('login-email').fill(reception.email);
  await page.getByTestId('login-password').fill(DEMO_PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('picker-signed-in')).toBeVisible();

  await page.goto(`${CONSOLE}/?session=${demo.sessionId}`);
  await expect(page.getByTestId('queue-table')).toBeVisible();
  return page;
}

async function openLiveSerial(context: BrowserContext): Promise<Page> {
  const booking = demo.bookingsBySerial.get(5);
  if (booking === undefined) throw new Error('no serial 5 in the fixture');

  const page = await context.newPage();
  await page.goto(await issueTrackingLink(booking));
  await expect(page.getByTestId('live-serial')).toBeVisible();
  return page;
}

test.describe('what is running is the production configuration', () => {
  test('the API is not the demonstration, and reaches its database as the limited role', async ({
    request,
  }) => {
    // Readiness is answered only once the API's own role has queried the
    // database (`/readyz`); the migration it reports is the newest there is.
    const ready = await request.get(`${API}/readyz`);
    expect(ready.status()).toBe(200);
    const readiness = (await ready.json()) as {
      data: { status: string; checks: { database: { ok: boolean } } };
    };
    expect(readiness.data.status).toBe('ready');
    expect(readiness.data.checks.database.ok).toBe(true);

    const config = await request.get(`${API}/api/v1/config`);
    const settings = (await config.json()) as {
      data: { demo: boolean; onlinePayments: boolean; guestPhoneCheck: boolean };
    };
    // If any of these three read otherwise, every test below is the
    // demonstration again and proves nothing about a hospital's server.
    // `scope` is whose app was asked about (`FR-BRD-02`): nobody's, here.
    expect(settings.data).toEqual({
      demo: false,
      onlinePayments: false,
      guestPhoneCheck: true,
      scope: null,
    });
  });

  test('the password-less picker is refused', async ({ request }) => {
    // The endpoint the demonstration's picker mints its token from
    // (`CLAUDE.md` §4.1). Open here, anybody could be a receptionist anywhere.
    const picked = await request.post(`${API}/api/v1/demo/token`, {
      data: { hospitalId: demo.hospitalId, role: 'receptionist' },
    });
    expect(picked.status()).toBe(403);
    const refusal = (await picked.json()) as { error: { code: string } };
    expect(refusal.error.code).toBe('AUTH_FORBIDDEN_SCOPE');
  });

  test('no screen says it is a demonstration (FR-DEM-07)', async ({ browser }) => {
    // Every console screen and four of the patient's used to print "This is a
    // demonstration. All data here is for display only" whatever they were
    // running against. Over a hospital's own patients that is false, and it
    // tells the person at the counter that what they enter does not count.
    const counter = await browser.newContext();
    const corridor = await browser.newContext();

    try {
      const console_ = await signInAndOpenChamber(counter);
      await expect(console_.getByTestId('offline-block')).toHaveAttribute(
        'data-connected',
        'true',
        {
          timeout: 15_000,
        },
      );
      await expect(console_.getByTestId('demo-banner')).toHaveCount(0);
      await expect(console_.getByText(DEMONSTRATION_LINE, { exact: false })).toHaveCount(0);

      // The registration desk, which is where a pilot's patients are entered.
      // Checked once the server's answer about itself is in, so a line that
      // was merely late would be caught.
      const answered = console_.waitForResponse((response) =>
        response.url().endsWith('/demo/status'),
      );
      await console_.goto(`${CONSOLE}/?view=registration`);
      await answered;
      await expect(console_.getByTestId('registration-console')).toBeVisible();
      await expect(console_.getByTestId('demo-banner')).toHaveCount(0);
      await expect(console_.getByText(DEMONSTRATION_LINE, { exact: false })).toHaveCount(0);

      // And the patient's own screen, on their own serial.
      const patient = await openLiveSerial(corridor);
      await expect(patient.getByTestId('now-serving')).toBeVisible();
      await expect(patient.getByTestId('demo-banner')).toHaveCount(0);
      await expect(patient.getByText(DEMONSTRATION_LINE, { exact: false })).toHaveCount(0);
    } finally {
      await counter.close();
      await corridor.close();
    }
  });
});

test.describe('the two-device queue, as a hospital runs it', () => {
  test('a reception tap reaches the patient in under two seconds (NFR-01, FR-PAT-31)', async ({
    browser,
  }) => {
    const counter = await browser.newContext();
    const corridor = await browser.newContext();

    try {
      const patient = await openLiveSerial(corridor);
      const console_ = await signInAndOpenChamber(counter);

      await expect(patient.getByTestId('now-serving')).toHaveText('১');

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
      const patient = await openLiveSerial(corridor);
      const console_ = await signInAndOpenChamber(counter);

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

  test('the number never appears without saying how old it is (FR-PAT-35, GR-05)', async ({
    browser,
  }) => {
    const corridor = await browser.newContext();

    try {
      const patient = await openLiveSerial(corridor);

      const freshness = patient.getByTestId('freshness');
      await expect(freshness).toBeVisible();
      await expect(freshness).toHaveAttribute('data-stale', 'false');
    } finally {
      await corridor.close();
    }
  });
});
